# 0115 — The house item is the ledger's key, and it is the row the house already has

- **Status:** **Locked 2026-10-02.** The founder picked *"Approve all as recommended
  (Recommended)"* (2026-10-02, 22:00 UTC). That option's text read: "Every remaining
  R-item takes its recommended option. I record them, then amend and lock ADR 0115 with
  every drinks ruling and plan the build migrations-first (lots first, tenths of a ml
  before recipes)." The lock covers this ADR as amended by §2026-10-02, which records
  his drinks rulings of 2026-10-01 and 2026-10-02. §Build order is the plan that option
  asked for. Of its ordering, only "lots first" and "tenths of a ml before recipes" are
  his words. The rest of the sequence, the gates and the PR sizing are this record's
  proposal, and he can change them. After the lock, his round-15 answers
  (§2026-10-02, "Round 15") settled OD-219 to OD-222, the reading of R31 against R93,
  and OD-218 apart from four sub-parts. His round-17 answers (2026-10-03,
  §2026-10-02, "Round 17") settled those four, so OD-218 is resolved too. Those
  answers rest on their own picks, quoted there, not on the lock pick. None of them
  covers the details under "Left open inside answered rulings". The lock is written the
  way his 2026-10-01 pick *"Lock + reopen wrong bits (Recommended)"* asked ("Mark it
  Locked and record the 2026-09-12 apply. The four claims the evidence overturned are
  reopened as the questions that follow. Docs only."): the four overturned claims are
  bracketed where they stand, each with the ruling that answered it.
  Before the lock: ~~Proposed~~ — the founder locks the shape. Migration written and **NOT
  applied** [CORRECTED 2026-10-02: applied. `20260903171000` reached main in `941d9cb40`
  (PR #289, 2026-09-12), and migrations apply to production on merge; CI "Schema parity"
  passed on `c14aeca03` (run 36934555267, 2026-10-01). Production itself was not queried
  for this record; lock review §7 holds the queries.]; no app code changed [CORRECTED
  2026-10-02: later code now reads the phase-1 columns, lock review §1]. **Six
  sub-decisions were taken on 2026-09-04 and are
  settled** — (a)–(e) by the founder, (f) delegated by the founder and decided here:
  (a) the library link is `ON DELETE RESTRICT` and
  soft-delete is the only retirement path; (b) a house item exists **only** through an
  explicit "carry this" that also states kind and unit — nothing auto-creates one
  [REVERSED 2026-10-02: his 2026-10-01 pick *"Menu creates them (Recommended)"* (X14)
  makes every drink on the menu a house item, unconfirmed until a person confirms its
  unit and size; see §2026-10-02, group 1];
  (c) the first enrichment writer funded is **beer style and IBU**, over the **BJCP
  style list with an `other` escape** — an off-list style is free text under `other`,
  flagged for the catalogue, and `other` sorts last [2026-10-02, R90: kept, but it ships
  thin first (`other` plus free text) until BJCP grants permission; group 1]; and (d) **phase 2 fixes the
  receiving door in the same dispatch** — ADR 0070's leftover lands together with the
  beverage rows' stock cards, as one named dispatch with both regressions tested
  separately; (e) the `kind` vocabulary ships as the **full thirteen values**, beverage
  kinds used first, with the note stating that only those have readers today
  [AMENDED 2026-10-02, R1: fourteen values, adding `hot_drink`, each kind with its own
  table]; and
  (f) **there is no phase-3 rename** — the `house_items` view settles the noun.
  **Every question on this ADR is now closed.** [CORRECTED 2026-10-02: it was not. The
  lock review found 13 open forks (claim C2). The founder answered them on 2026-10-01 and
  2026-10-02 (§2026-10-02). The forks filed there as OD-218 to OD-222 were put to him in round 15, and the
  four sub-parts of OD-218 that round 15 did not ask were put to him in round 17. All five are answered;
  the details under "Left open inside answered rulings" are not forks and are not closed by them.] See §Retirement, §Coming into being,
  phase 2 items 3a and 6–7, and §Questions 2 and 4 for the reasoning on (e) and (f).
- **Date:** 2026-09-03 (sub-decisions 2026-09-04; drinks rulings and lock 2026-10-01 to 2026-10-02)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** OD-113, identity axis, ledger, house item, restaurant_inventory, master_wine_id, beverages, uom, kind, stock, par, counts, orders, non-wine, keg, table per kind, exclusive arc, hot_drink, rakı, ml, tenths of a ml, formats, serves, build order
- **Links:** [[0070-a-quantity-states-its-own-unit]] (the quantity axis; this is the identity axis it parked),
  [[0108-a-register-is-the-houses-own-books-first]], [[0016-ledgers-must-express-unknown]],
  [[0030-pos-mapping-inventory-integrity]], [[0051-rebuilt-pages-show-live-data-only]],
  [[0072-schema-parity-sees-what-it-claims]], [[0076-a-repoint-names-the-referencing-column]],
  OD-113 in `OPEN-DECISIONS.md:72`,
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
[2026-10-02: built as phase 1 and kept, but no longer the shape for non-wine; see the
bracket under §Decision.]

### H4 — per-register stock tables (`beer_stock`, `whiskey_stock`, …)

Costs the decision itself: seven registers means seven ledgers, seven low-stock
producers, seven count paths, and a POS mapping that must know which table a
till line lands in. Every cross-register question ("what is the whole cellar
worth") becomes a seven-way union that a new register silently breaks by being
absent from it. Refused. [AMENDED 2026-10-02: a table per kind for the **items** is
now the shape, by his 2026-10-01 pick *"A separate table per kind"*. A stock book per
kind stays refused: his pick *"One book, rows name kind (Recommended)"* (A2) keeps one
stock book whose rows name their kind, so the seven-ledgers cost above is still avoided.]

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

[AMENDED 2026-10-02: his 2026-10-01 picks replace this shape for every kind but wine.
He picked *"A separate table per kind"*. He did not pick *"One id + per-kind tables
(Recommended)"*, which kept this paragraph's one id, or *"One table, kind columns"*.
He then picked *"One checked link per kind (Recommended)"*, whose option text read
"Wine stays in today's table, with no rows moved". So:
- `restaurant_inventory` becomes the **wine** table. It is not the one table every kind shares.
- Each other kind gets its own `<kind>_items` table (R13).
- Every place that names an item gets one database-checked link per kind table, with
  exactly one filled (an exclusive arc).
- `house_items` becomes a UNION ALL over the kind tables (D5 in §Build order).
- The phase-1 columns stay. Drinks that are filed as wine today but are not wine move
  out once, last (A5).
The four reasons below argued for one id. The option he picked named their cost: "This
supersedes ADR 0115's one-id design, and every stock, lot and POS path must learn each
table." They stay here as the record of what that choice gives up. See §2026-10-02.]

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
| `kind` | `text NOT NULL` | CHECK `{wine, beer, whiskey, spirit, liqueur, cocktail, sake, cider, non_alcoholic, soft_drink, food, supply, other}`. **No DEFAULT** — a default is how a keg becomes a bottle. [AMENDED 2026-10-02, R1: fourteen values, adding `hot_drink` (X1). D1 widens this CHECK before it creates `hot_drink_items`. Rakı is a family inside `spirit` (X3), not a kind.] |
| `uom` | `text NOT NULL` | CHECK: the container units `{bottle, case, keg, pack, each, glass, shot}` plus ADR 0070's base units `{ml, l, mg, g, kg}`. **No DEFAULT.** [AMENDED 2026-10-02: drink stock is held in ml (A6), kept to tenths of a ml (R81), and weight items in g ("Grams / ml at the door"). A container size is a format row, not a unit (R3). `can` and `bag_in_box` are container types on formats (R55), and counted pieces are `each`. Wine keeps its bottle unit until each wine is sized (R7).] |
| `display_name` | `text NOT NULL` | Backfilled `coalesce(nullif(btrim(wine_name),''), library.name)` — measured to cover all 206 rows (53 have a blank `wine_name`; all 206 resolve to a named library row). |
| `beverage_id` | `uuid NULL REFERENCES public.beverages(id) ON DELETE SET NULL` | The catalogue link for a non-wine. Deleting a catalogue row must never delete a house's stock. |
| `identity_provenance` | `text NOT NULL` | CHECK `{wine_library, beverage_catalogue, house_declared, backfill}`. Says how this row got its name. |
| `master_wine_id` | `uuid` — **nullable**, FK **`ON DELETE RESTRICT`** | Was the key; becomes an attribute. An attribute may not delete the row it describes — see §Retirement. |

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
[CORRECTED 2026-10-02 (lock review C22): mechanically true, wrong in effect. The
trigger never reads `master_wine_library.beverage_kind`, so a beer or whiskey
linked from the library is stamped `wine`
(`20260903171000_the_house_item_is_the_ledgers_key.sql:431`). On 2026-10-01 the
founder picked "Library kind + menu section (Recommended)": a library-linked item
takes the library's kind, or else the menu section's. R2's mapping and D1 in
§Build order carry it.]

**Two partial unique indexes** so a non-wine cannot silently duplicate: on
`(restaurant_id, beverage_id) WHERE beverage_id IS NOT NULL AND deleted_at IS
NULL`, and on `(restaurant_id, lower(display_name)) WHERE master_wine_id IS NULL
AND beverage_id IS NULL AND deleted_at IS NULL`. The existing UNIQUE keeps wine.

**`public.house_items`**, a view over the table with `security_invoker = true` —
without that flag a view runs with the definer's rights and would bypass the
table's RLS. Revoked from `anon`/`authenticated`, granted to `service_role`.

### Retirement, not deletion (founder, 2026-09-04)

The question put was: what should happen when a library wine is deleted, and how
would an erroneous deletion be caught? The answer taken has three parts, and all
three are in phase 1.

**1. `ON DELETE RESTRICT`.** The FK was `CASCADE`, which meant a catalogue edit
could delete a house's stock row — and, through `inventory_lots`' own cascade, its
lots with it — silently, irreversibly, and leaving no record anywhere that the
house had ever carried the wine. That is acceptable for a *key* and indefensible
for an *attribute*. `SET NULL` was considered and rejected: it keeps the stock and
throws away the only thing that says what the stock *is*, producing a row nobody
can interpret, which is the same failure this ADR exists to remove.

**Measured before changing it, so the cost is known rather than assumed:**

- `master_wine_library.deleted_at` already exists and is *exercised* — **664 of
  4 226** rows are soft-deleted.
- `merge_library_wines()` **no longer hard-deletes**:
  `20260817120000_nondestructive_merge.sql:3,15` replaced the `DELETE` with
  soft-delete plus `superseded_by`. Checked against the live database rather than
  the migration files, because a function body is `CREATE OR REPLACE`d: **zero**
  live functions in production hard-delete from `master_wine_library`. The two
  `DELETE FROM public.master_wine_library` lines that remain in the tree
  (`20260813030000:211`, `20260813040000:167`) are in superseded bodies.
- **199** distinct library wines are stocked by a house, and **0** of them are
  soft-deleted — so RESTRICT starts from a clean baseline and breaks no path that
  exists today.

**2. The refusal names the count.** A bare FK violation says *"still referenced
from table restaurant_inventory"* — true, and useless: it names no house, no
count, and no remedy. A `BEFORE DELETE` row trigger fires ahead of the constraint
check, so `refuse_to_delete_a_stocked_wine()` is where the sentence lives. Proved
live, not described:

> `master_wine_library bbbb…: 1 house item row(s) across 1 house(s) still key on
> this wine, so it cannot be hard-deleted. Retire it instead — UPDATE
> public.master_wine_library SET deleted_at = now() WHERE id = … — which leaves
> every house's stock, cost and pour history intact and flags the link rather
> than cascading it.`

The FK stays as the backstop for the case where the trigger is disabled. And an
**unstocked** wine is still deletable — measured — because a rule that made every
catalogue row immortal would be a worse bug than the one it replaced.

**3. The link is flagged, never cascaded — and never silent.** Invariant 7 splits
on severity, on purpose. A house item pointing at a wine that *no longer exists*
is a **failure**; a live house item keying on a *retired* wine is a **flag**. The
second is not a defect — a house pours the last bottle of a retired wine over
weeks — so failing the build on it would punish the correct action. But it is
printed loudly rather than dropped, because silence is the one outcome this rule
forbids. Phase 2 item 6 turns that flag into the notification a human actually
sees.

### Coming into being: only "carry this" (founder, 2026-09-04)

[REVERSED 2026-10-02. The lock review found this was already untrue in practice: making a
menu current seeds a house item for every library-matched line (`menus.service.ts:1496`,
`:1720`, insert `:1908-1916`; claim C3). On 2026-10-01 the founder ruled the other way:
- In his own words: *"menu carries everydrink create the right databases for those with
  their indexes configured"*.
- Then *"Menu creates them (Recommended)"*. Its option text: "every drink on the menu
  becomes a house item, marked unconfirmed until a person confirms its unit and size. A
  brandless line ('Tek Rakı') makes a pending link, not an item."

What the section below fears is still guarded, by three rulings rather than by refusing to
create:
- the unit comes from the menu line or is held unconfirmed (*"Read menu, confirm unknowns
  (Recommended)"*);
- nothing depletes on an unconfirmed unit or size (*"Queue it, take nothing
  (Recommended)"*, A8);
- a kind nobody can name is held for a person (*"Hold for a person (Recommended)"*, A12).

The text below is kept as the record of the 2026-09-04 ruling.]

**A house item is created by one explicit action and no other.** The "carry this"
action states the kind and the unit in the same step that creates the row. Nothing
infers a house item and nothing back-fills one: a menu line, an invoice line, a
quote or a till line that matches no house item **stays unmatched and says so**.

This answers §Questions 3 and reverses that section's tentative reading. The
temptation is real — ADR 0108's five-book ledger already knows every non-wine
product a house touches, and auto-creating a zero-stock row for each would make
the registers look complete overnight. It is refused because a row created that
way would carry a `kind` and a `uom` that nobody stated, which is exactly the
silent characterisation `NO DEFAULT` and `set_house_item_identity()` exist to
prevent — arriving through the front door instead of the back. An unmatched line
that says it is unmatched is the truth; a fabricated house item is a number.

The consequence is stated rather than hidden: the registers stay as thin as the
house's own deliberate answers, and the five books keep showing products with no
house item behind them, labelled as such.

## The cut-over, in three phases, each with its rollback

**Phase 1 — additive, written and NOT applied
(`20260903171000_the_house_item_is_the_ledgers_key.sql`).** [CORRECTED 2026-10-02:
applied with PR #289 on 2026-09-12; see Status.] Everything in §The
shape, including §Retirement's `ON DELETE RESTRICT` swap and its refusal trigger.
No app code changes. No FK is repointed and no reader is switched.
*Rollback:* `DELETE FROM restaurant_inventory WHERE master_wine_id IS NULL`, then
`SET NOT NULL`, then drop the five columns, both triggers, the two indexes and
the view, and put the FK back on `CASCADE` if that is really wanted. Reversible
**only while no non-wine row exists**, which is true for exactly as long as phase
2 has not shipped. Stated because it is the phase boundary that matters.
[CORRECTED 2026-10-02 (lock review C23): this rollback no longer works. Later code
reads the five columns: `procurement.service.ts` selects `display_name`, migration
`20261116101200` reads `ri.display_name`, and ADR 0192's build books lots with a NULL
master wine. Phase 1 is effectively irreversible. The migration file's header still
lists "Consider renaming restaurant_inventory to house_items" under phase 3 (`:93`),
and a comment at `:290` says the wine FK "is still ON DELETE CASCADE". Both are stale (C24): (f) settled "no rename", and the
file's §1a swaps the FK to RESTRICT. They are corrected here and not in the applied
file.]

**Phase 2 — teach the write paths (a separate dispatch, app code).** In order:

[AMENDED 2026-10-02: as a plan, this list is superseded by §Build order, which
builds a table per kind instead of teaching one table every kind. Items 1 and 2
still describe live defects and are carried into that order. Item 1's line has
moved: `?? 750` is now at `inventory.service.ts:80` (lock review C14). Item 3 is
reversed (see the bracket under §Coming into being), and item 5 is wrong (see the
bracket on it).]

1. `apps/api-gateway/src/inventory/inventory.service.ts:69` — `row.master_wine_library?.bottle_size_ml ?? 750`
   invents a 750 ml bottle for any row with no library link. It must become an em
   dash. **This is the one line that turns the migration from safe into
   dangerous if it ships alone**, and it is why the migration is gated.
2. `apps/api-gateway/src/database/database.service.ts:46` — the embed is a LEFT
   join and returns `master_wine_library: null` for a keg; every consumer of that
   shape must be read.
3. **The "carry this" action** — the only way a house item comes into being. One
   deliberate step that supplies `kind`, `uom`, `display_name` and
   `identity_provenance` together. No other path creates a row; an unmatched book
   line renders as unmatched.
3a. **The receiving door, in this same dispatch** (founder, 2026-09-04). ADR 0070
   listed this under "explicitly out of scope, and blocking the same goal" and it
   has blocked it ever since: **the receiving door cannot express a mass unit, so
   the ledger's new `uom` vocabulary stops at the door.** Shipping the stock cards
   without it would put `kg` on the item and leave a receiver unable to take a
   flour delivery — a house item that can state its unit and an intake that cannot
   accept it. So the two land together, as one named dispatch.

   Re-measured 2026-09-04, and the first number is worse than ADR 0070 recorded:
   the intake CHECK is `{bottle, case, keg, pack, split_case, each, liter}` with
   **zero mass units**, and it exists in **two** places, not one —
   `procurement_document_lines_uom_check`
   (`20260805000000_baseline_from_production.sql:4401`) and
   `procurement_receipt_events_uom_check` (`…:4593`) — plus a third copy of the
   vocabulary inlined in
   `20260901150000_order_line_capture_and_units.sql:106`. All three move or none
   does; widening one and not the others produces a line the invoice accepts and
   the receipt refuses. On the API side, `@IsInt()` appears **98 times across 21
   DTO files** repo-wide; ADR 0070's "15" is the *quantity* subset (10 of them in
   `procurement.dto.ts`, the 15th at `storage-locations.dto.ts:146`), so the
   dispatch's first job is to re-derive that subset rather than trust the count —
   changing a non-quantity `@IsInt()` is a silent widening of something unrelated.

   **Both regressions are tested separately**, per the founder: one suite proves a
   beverage row's stock card, one proves the door takes `4.5 kg` end to end and
   still refuses a unit outside the vocabulary. A single suite covering both would
   let either half pass on the other's evidence.
4. `unit_type` documented as superseded by `uom` and stopped being read.
5. `low-stock-alerts.service.ts:683-690` already reads `stock_live` and
   `threshold_min` off whatever row it is given — it needs no change, and that is
   the point.
   [CORRECTED 2026-10-02 (lock review C16): this was wrong. The file is
   `notifications/low-stock-alerts.service.ts`; it reads only the view
   `v_low_stock_items` (`:1176`, `:1261`), and that view joins
   `master_wine_library` with an inner join
   (`20260805000000_baseline_from_production.sql:6004`, join `:6046`), so an item
   with no library link never appears in it and never alerts. The founder picked
   "Every kind, par in ml (Recommended)" on 2026-10-01; the view change is D5 in
   §Build order.]
6. **A producer: "a wine your house stocks was retired from the library."**
   *Design only — do not build in this dispatch.* Phase 1 makes soft-delete the
   only retirement path, which means a retirement is now completely silent to the
   house that is still pouring the wine; that is the same fault as a cascade, only
   slower. **Shape:** a scheduled read under `ScheduledTenantsService.runPerTenant`
   (ADR 0022), joining live `restaurant_inventory` rows to
   `master_wine_library.deleted_at IS NOT NULL`, writing through
   `persistForRestaurant` like every other producer, claiming before it writes
   (`20260903143000_a_producer_claims_before_it_writes.sql`) so a retirement is
   announced once and not once per run. **It names the rows** — the wine, the house
   items that key on it, the stock still on hand and, where `superseded_by` is set,
   the keeper it was merged into — because "a wine was retired" with no list is a
   notification nobody can act on. Invariant 7's FLAGGED line is the query this
   producer runs; until it exists, the guard is the only thing that says so, and
   only to whoever runs it.
7. **The first enrichment writer: beer style and IBU.** *Design only — do not build
   in this dispatch; funded ahead of the rest by the founder, 2026-09-04.* Measured
   2026-09-04: `beverages.type_attributes` is `'{}'` on **all 608** catalogue rows,
   so the **57** beer rows carry **0** styles and **0** IBUs — which is what makes
   a beer register a list of brand names (`wines.md` §13 roadmap item 1 already
   called this the highest-value missing writer). **Two writers, one field, and the
   row says which spoke:**
   - *The house, at carry-time.* The "carry this" dialog, for `kind = 'beer'`,
     offers a **style picker over the BJCP list, with an `other` escape** (settled
     below) and an optional IBU. Never pre-filled from a guess; left blank it stays
     an em dash with its reason.
     Storage is the house item's own attributes — a `house_attributes jsonb NOT
     NULL DEFAULT '{}'` column on `restaurant_inventory`, added by phase 2's own
     migration, **not** by phase 1. `'{}'` is the honest empty rather than a
     characterising default: it asserts nothing about the item, which is the whole
     distinction phase 1's `NO DEFAULT` rule is drawing.
   - *The catalogue, where a match exists.* Where the house item carries a
     `beverage_id` and that row's `type_attributes` holds a style, the read uses it
     and **labels it as the catalogue's**, not the house's. The house may not write
     to `public.beverages` — ADR 0108 refuses tenants a write path into a shared
     catalogue whose identity is trigger-set, and that refusal is unchanged here.
   - *Precedence and provenance.* The house's own value wins; every rendered value
     states which writer it came from and when. A field with neither is an em dash
     naming both books it looked in.
   **The vocabulary is settled (founder, 2026-09-04): the BJCP style list, with an
   `other` escape.** A style that is on the list is chosen from it. A style that is
   not is typed as free text, stored under `other`, and **flagged for the
   catalogue** — so the gap is a queue somebody can work rather than a silent
   divergence. Sorting and filtering run on the style, and **`other` sorts last**:
   an unrecognised style is never allowed to interleave with the named ones and
   quietly look like one of them.
   [AMENDED 2026-10-02, R90 "Ship thin, ask BJCP (Recommended)" = beer F-STYLE
   (c): the style table ships with only `other` and free text; the BJCP styles are
   seeded, with attribution, once BJCP gives permission, and a person sends that
   request. Until then style filters are thin. See §2026-10-02, group 1.]

   The escape is what makes the closed list survivable. A purely closed list would
   have forced the operator to file a real beer under a wrong style — the single
   worst outcome here, because a wrong style is indistinguishable from a right one
   downstream, whereas `other` announces itself. Pure free text was refused for the
   reason the writer is funded at all: it leaves the register unsortable and
   unfilterable, which is the state the beer register is in today. This shape keeps
   the sort while never asking anyone to lie.

   Two consequences to build to, not discover: the free text under `other` is
   **display and triage only** — it is never promoted to a style by a matcher, and
   it must never become a second style vocabulary growing beside BJCP; and the flag
   is the same shape as invariant 7's, a row a human is told about, so it should
   reach the founder through a real surface rather than living only in the column.

*Rollback:* revert the code; the schema stays, because the schema is additive.

**Phase 3 — drop the old key (a separate dispatch, gated on a green guard for a
measured period).** `inventory_lots.master_wine_id` and
`inventory_transactions.wine_id` resolve through `inventory_id` and are dropped.
**There is no rename**: the table keeps the name `restaurant_inventory` and the
`house_items` view carries the noun (question 4, answered 2026-09-04). [AMENDED 2026-10-02: under "A separate table per kind" (§2026-10-02, group 1), `restaurant_inventory` keeps its name as the wine table, each other kind gets its own `<kind>_items` table (R13), and `house_items` becomes a UNION ALL over them (D5). §Build order has no phase 3 step. No ruling says when, or whether, the old key columns are dropped.] *Rollback:*
re-add the columns and
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
7. **The library link is retired, never deleted** (founder, 2026-09-04). Split on
   severity, deliberately:
   - **FAIL** — a house item points at a library wine that **no longer exists**;
     or the FK is not `ON DELETE RESTRICT`; or
     `refuse_to_delete_a_stocked_wine()` is gone. Each is the cascade coming back,
     or the evidence that it already came back once.
   - **FLAGGED, not failed** — a live house item keys on a **retired**
     (soft-deleted) wine. A house pours out a retired wine over weeks, so failing
     the build would punish the correct action. It is printed loudly rather than
     dropped, because silence is the one outcome the rule forbids, and phase 2
     item 6 is what turns the flag into a notification a human sees.

The guard is **not wired into CI by this ADR** — the parent does that at lock
time, because a blocking guard against a migration that has not been applied
would fail every build.
[CORRECTED 2026-10-02: the migration is applied (see Status), so that reason is
gone. The lock does not wire it in either: invariant 4 crashes on PGlite with
`"array_agg" is an aggregate function` (lock review C19), and R24, approved in
the bulk pick, wires it into CI only after that is fixed. Owed in
`.planning/tech-debt.d/2026-10-02-docs-adr-0115-drinks-lock.md`.]

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
  [CORRECTED 2026-10-02 (lock review C16): not without a change. Low-stock reads
  only `v_low_stock_items`, which inner-joins the wine library, so a keg never
  alerts. It needs D5 in §Build order; see the bracket on phase 2 item 5.]
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
[AMENDED 2026-10-02: under "A separate table per kind" each kind has its own item
table, and a reference names its kind through one link per kind (A1), so there is no
single key across registers; see §2026-10-02, group 1.]
Food becomes representable end to end once ADR 0070's `uom` is on the item, which
it now is. [CORRECTED 2026-10-02: the item-level `uom` exists
(`20260903171000_the_house_item_is_the_ledgers_key.sql:277`), but ADR 0070's
row-level `uom` on the ledgers is not shipped (§Build order, M2). Food is received
and counted only; recipes and depletion come later (§2026-10-02, group 1, Food).] `/menu` unblocks (`wines.md:1546` held it on OD-113 [CORRECTED 2026-10-02: that hold is now at `wines.md:691-692`]). Deadstock and
velocity on a non-wine row become arithmetic rather than a wait.

**Harder, or given up.** The table keeps its name and its 64 wine-shaped columns
until phase 3; a keg row carries `pour_size_ml` and `glasses_per_bottle_override`
and means nothing by them. [AMENDED 2026-10-02: a keg is a beer item with unit keg
(X2), in the beer table, not a `restaurant_inventory` row. `restaurant_inventory`
stays the wine table.] "House item" and "stock row" are the same object, and
since a house item is created **only** by an explicit "carry this"
(§Coming into being), a product the house merely knows about has no row at all —
it stays an unmatched line in the five books, labelled as one. [REVERSED 2026-10-02
by X14, *"Menu creates them (Recommended)"*: every drink on a current menu becomes
a house item, unconfirmed until a person confirms its unit and size; see
§2026-10-02, group 1.] That is the cost of
the founder's 2026-09-04 call and it is the right one: the registers stay as thin
as the house's own deliberate answers rather than filling up with rows whose kind
and unit nobody stated. And a merge of two library wines now moves a house item,
not just a wine — `20260902160000_merge_repoints_by_referenced_column.sql` and ADR
0076 must be re-read before the first non-wine merge; note that the merge path
already soft-deletes rather than deletes, so §Retirement's RESTRICT does not
obstruct it.

**Given up deliberately: enforcement by the database.** Four of the eight ledger
tables have no foreign key to `restaurant_inventory`, so the invariant "every
stock row keys on a house item" is held by a script. That was already true before
this decision; this ADR is the first document to say so. The one place enforcement
moves *into* the database is §Retirement: `ON DELETE RESTRICT` plus a refusal
trigger, because a cascade that has already fired cannot be reported after the
fact — the rows it took are gone.

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

[AMENDED 2026-10-02: answer 2 is widened by R1 to fourteen values (adding
`hot_drink`), and answer 3 is reversed by X14 "Menu creates them (Recommended)".
Every answer below is kept as it was given; see §2026-10-02.]

1. ~~**`restaurant_inventory_master_wine_id_fkey` is `ON DELETE CASCADE`**~~ —
   **ANSWERED 2026-09-04.** `ON DELETE RESTRICT`, soft-delete is the only
   retirement path, the refusal names the count, and the link to a retired wine is
   flagged rather than cascaded. Built in phase 1; see §Retirement, not deletion.
2. ~~**Is the `kind` vocabulary right?**~~ — **ANSWERED 2026-09-04.** The **full
   thirteen-value list ships now**, `food` and `supply` included, and the beverage
   kinds are the ones used first. The vocabulary is not the same thing as the
   roadmap: a CHECK that already admits `food` costs nothing until a row uses it,
   whereas widening it later is a migration against live rows at exactly the moment
   the bakery work is trying to move (`INVENTORY_SOTA_PLAN.md:338` sequences wine →
   beverages → bakery → kitchen). What the note must say, and does, is that **only
   the beverage kinds have readers today** — no surface renders a `food` or
   `supply` row, and the CHECK admitting one is not a claim that anything can yet
   do anything with it.
3. ~~**Does a house item exist before it is stocked?**~~ — **ANSWERED 2026-09-04.**
   Only through an explicit "carry this" that also states kind and unit. Menu and
   invoice lines that match nothing stay unmatched and say so; nothing
   auto-creates a house item. See §Coming into being.
4. ~~**Phase 3's rename.**~~ — **ANSWERED 2026-09-04. No rename. The `house_items`
   view settles the noun, permanently.** The founder delegated this one on
   premortem, future technical change, scalability and cleanliness; all four point
   the same way.

   **Premortem.** The rename is a 199-call-site mechanical change, and its only
   failure mode is a missed site left reading a table that no longer exists — a
   break that is silent at write time and surfaces as absent data, which is the
   exact shape this codebase names as its cardinal fault. A rename buys a nicer
   name by adding the one class of bug the repo is least able to detect.

   **Future technical change.** The view already gives every future reader the
   right noun, at zero risk. New code says `house_items`; nothing has to be swept
   for that to be true.

   **Scalability.** Unaffected either way — same rows, same indexes. A view is not
   a materialisation and adds no storage and no write path.

   **Cleanliness.** Better served by one name in the code and one in the schema
   that the view maps than by a rename that still leaves 88 migration files, the
   production baseline and every archived note saying `restaurant_inventory`. A
   rename does not remove the old name from the corpus; it only removes it from the
   places that are cheapest to read.

   **The condition that would reopen this:** the noun leaking into a public API or
   a partner contract. That is the day to rename — and by then the view is already
   there to rename *behind*, which is the cheap order to do it in.
5. ~~**The ADR 0070 sequencing.**~~ — **ANSWERED 2026-09-04.** Phase 2 fixes the
   receiving door in the **same dispatch** as the beverage rows' stock cards, with
   both regressions tested separately. See phase 2 item 3a.
6. ~~**The beer style vocabulary**~~ — **ANSWERED 2026-09-04.** The BJCP list with
   an `other` escape: an off-list style is typed as free text under `other` and
   flagged for the catalogue; style sorts and filters, and `other` sorts last. See
   phase 2 item 7. Phase 2 item 7 is now unblocked on vocabulary.

## 2026-10-02 — every fork put to the founder answered; shape locked

The founder answered every drinks fork put to him on 2026-10-01 and 2026-10-02.
Forks that were not put to him then were filed as OD-218 to OD-222. He answered
them in round 15, later on 2026-10-02 ("Round 15" below), except four sub-parts of
OD-218 that were never asked. He answered those in round 17, on 2026-10-03
("Round 17" below).
This section is the in-repo record of those answers. Each row gives his pick
verbatim, what it means in one line, what he did not pick, and where it is
written down. Picks are quoted byte for byte from the primary record, so his
typos are kept.

**Sources.** None of these files is in the repo.
- **TX**: the session transcript
  `/Users/aldemirkonuk/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/3fe4d5cf-8da5-4559-85d1-ed6e4c493b52.jsonl`.
  This is the primary record, and its times are UTC.
- **MEM**: `/Users/aldemirkonuk/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/memory/founder-answers-2026-10-01-drinks-and-orders.md`.
- **SC**: `/Users/aldemirkonuk/.claude/projects/-Users-aldemirkonuk-Projects-restaurant-ai-automation/memory/scope-all-beverages-then-foods.md`.
- **RV**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/revision/README.md`.
  It holds R1 to R93, each with an `[Answered …]` line.
- **BA**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/revision/BULK-APPROVAL.md`.
- **FK**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/forks.md`.
- **RN**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/raki-naming.md`.
- **DR**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/README.md`.
- **AR**: `/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/architecture.md`.
- **LRV**: `/Users/aldemirkonuk/Projects/p4-scratch/adr-0115-lock-review-2026-10-01.md`.
- **R15**: `/Users/aldemirkonuk/Projects/p4-scratch/founder-answers-2026-10-02-round15.md`,
  the round-15 picks. It shortens some question text with "..."; TX holds it whole.
  [Note 2026-10-03: a cite with a line number, such as R15:5-7, is this file. A bare
  R15 is the group 10 ruling on tenant-scoped FKs.]
- **RQ17**: `/Users/aldemirkonuk/Projects/p4-scratch/founder-answers-2026-10-03-round17-od218.md`,
  the round-17 picks. It is not named R17, because R17 is the group 10 ruling on
  embed hints. TX holds each option's full text.

**Dates.**
- The picks called "2026-10-01" ran from 2026-10-01T23:01Z to 2026-10-02T04:10Z.
  That is the evening of 2026-10-01 in the founder's time zone (UTC-4), ending
  at 00:10 on 2026-10-02.
- The 2026-10-02 picks came in eleven batches (UTC): 1 at 16:22, 2 at 17:56,
  3 at 19:43, 4 at 19:47, 5 at 20:17, 6 at 20:19, 7 at 20:32, 8 at 20:39,
  9 at 21:20, 10 at 21:58 and 11 at 22:00.

**Bulk.**
- At batch 11 he picked "Approve all as recommended (Recommended)"; the rejected
  option was "I'll read it first".
- A row whose pick reads *bulk* took "this item's recommendation as stated in
  `BULK-APPROVAL.md` and here", in the words of RV's bracket on each such item.
- For a *bulk* row, "What it means" restates that recommendation, and
  "Rejected" lists the other options RV gives.

**Two picks differ from a recommendation, and not the same kind of
recommendation.**
- **R48** differs from the *written* recommendation.
  - RV:368 and BA:24 recommended rounding to whole ml and carrying the
    remainder.
  - The live option he picked carried the "(Recommended)" label: "Keep tenths,
    like R81 (Recommended)".
- **R93** differs from the *live label*.
  - RV:588 and BA:97 recommended wine-only, with the research queue refusing
    non-wine. That is what he picked.
  - The live option labelled "(Recommended)" was "ML wine-only, research not
    closed", and he declined it.

Both rows are marked.

### Group 1: kinds and naming

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Scope | "it won't just handle wines, it will handle all beverages and then foods. only the wine items are extracted for ML, but all drinks are extraccted if they have the spot, + the beer whiskey and beverage filters must be live as well?" | Mudavym covers every drink, then food. ML stays wine-only (see group 9). | — (his own words, typed into an answer about order priority) | TX 2026-10-01T23:01Z. SC:12-14 has the same words with "extraccted" corrected. |
| Table shape | "A separate table per kind" | Each kind gets its own item table, and `restaurant_inventory` becomes the wine table. | "One id + per-kind tables (Recommended)", "One table, kind columns" | TX 23:47Z; MEM:18 |
| Library kind (lock review C22) | "Library kind + menu section (Recommended)" | A library-linked item takes the library's kind, or else the menu section's; it is no longer stamped `wine`. | "Library kind only", "Leave as is" | TX 23:44Z; MEM:15 |
| The spot (lock review C3) | "menu carries everydrink create the right databases for those with their indexes configured" | Every drink on a current menu gets an item, in the right table. "Indexes configured" was filed as OD-220, and round 15 answered it: both kinds. | "Wine auto, rest bulk-carry (Recommended)", "Menu carries every drink", "A register the house turns on" | TX 23:44Z; MEM:16 |
| X14 | "Menu creates them (Recommended)" | Making a menu current creates the items. This reverses settled sub-decision (b). | "Menu proposes only" | TX 03:24Z; MEM:57 |
| Food | "Now, receive + count (Recommended)" | Food can be carried now: the option text said "'Carry this' offers all 13 kinds now". Food is only received and counted, and recipes and depletion come later. No food table is built yet. Its design was filed as OD-219, and round 15 answered it: design and attack first. | "Beverages only now" | TX 23:44Z; MEM:17 |
| R1 | "Yes, 14 kinds (Recommended)" | The thirteen kinds plus `hot_drink`, each with a table. Whiskey stays separate. | "Fold whiskey into liquor" | RV:98 |
| X1 | "Own kind (Recommended)" | Hot drinks (coffee, tea, sahlep) are kind `hot_drink` and have their own table. | "Fold into soft drinks", "Ingredients are food" | TX 03:17Z; MEM:52 |
| X3 | "raki is alcohol", then "spirits is sounded soft drinks not as hard alcohol, see how industry do", then "Rakı chip, "Hard liquor" (Recommended)" | Rakı is a family in the `spirit` table, with ouzo and arak beside it. People see a "Rakı" chip first. "Hard liquor" appears only where one word must cover everything, and the internal kind does not change. | "Spirit family + own chip (Recommended)" and "Its own kind and table" (first round); "Yes, with spirits (Recommended)" and "Its own alcohol kind" (second round); "Rakı chip, "Liquor"" and "Rakı its own kind and table" (third round) | TX 03:17Z, 03:18Z, 03:50Z; MEM:51, :71; RN |
| X3 follow-up | "Liqueurs get their own (Recommended)" | Liqueurs, vermouth, aperitifs and amaro show as their own "Liqueurs & aperitifs" register. "Hard liquor" holds distilled drinks only. | "Keep them under Hard liquor" | TX 04:10Z; MEM:75 |
| R13 | *bulk* | Tables are named `<kind>_items` and share one Turkish fold function and `deleted_at`, all set once in D1's generator. | `house_<kind>s` | RV:176; BA:130 |
| R2 | *bulk* | One fixed mapping from library kind to item kind, written in an ADR. Where the library cannot say, the menu section or a person decides. Graft G6's SQL function ships first. | Widen the library vocabulary, which would amend ADR 0186 | RV:110; BA:89 |
| R54 | "Each item's category (Recommended)" | "Menu section" means the per-line category the menu import extracts. | "The printed heading" | RV:397 |
| R88 | "Take the teams' picks (Recommended)" | Vermouth, fruit wine, seltzer, NA beer, zero-proof and RTD go where each kind team placed them. Post-mix and fresh juice go to soft drinks. This sits beside R64 (house juices are preps); see "Left open inside answered rulings". | "All alcohol-free in one place", "Port and sherry with vermouth" | RV:560 |
| A12 | "Hold for a person (Recommended)" | An item whose kind neither the library nor the menu can tell waits for a person. | "File as wine", "File as 'other'" | TX 03:33Z; MEM:64 |
| A14 | "One named action (Recommended)" | An item filed under the wrong kind, with stock, is moved by one named action. | "New item + transfer" | TX 03:33Z; MEM:64 |
| R90 | "Ship thin, ask BJCP (Recommended)" | Kind chips go live now; sub-filters come only with a populator. The beer style table ships with only `other` and free text (beer F-STYLE (c)). BJCP styles are seeded, with attribution, once BJCP gives permission, and a person sends that request. | "Wait for permission", "Our own short list" | RV:570; FK:1659 |

### Group 2: units and ml

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Menu unit | "Read menu, confirm unknowns (Recommended)" | The carry reads the unit from the menu, and a person confirms any unit the menu does not state. | "Always bottle, fix by hand", "Ask during menu-current" | TX 23:47Z; MEM:19 |
| Count unit | "Grams / ml at the door (Recommended)" | Weight counts in g and volume in ml. The door converts 4.5 kg to 4500 g, and an item's unit freezes once it has stock. Sealed documents stay unchanged. | "kg / l, whole numbers", "Decimal stock" | TX 23:47Z; MEM:19 |
| A6 | "everything in milliliters, but basically whiskey glass, certain amount, beer glass, certain amount, um, wine glass, certain amount. So each of them will be milliliters, but those need to be declared." | Drink stock is held in ml, and each glass size is declared. | "Bottles + open ml (Recommended)" | TX 03:24Z; MEM:56 |
| R81 | "Finer than 1 ml (Recommended)" | Stock keeps tenths of a ml. This must land before any recipe explosion. | "Round to whole ml" | RV:528 |
| R48 | "Keep tenths, like R81 (Recommended)" | A fractional till quantity is multiplied by the serve's ml and kept in tenths, with no rounding and no carried remainder. **This overrides** the rounding recommended at RV:368 and BA:24. | "Round to whole ml", "Queue for a person" | RV:365 |
| R55 | "As 'each' (Recommended)" | Pieces such as sachets and sticks count as `each`. The door asks how many are inside a `kutu`, and packs and cases are formats. | "Weigh them in g" | RV:402 |
| R57 | *bulk* | The house weighs its scale weights now; a vendor database can follow later. | Density defaults | RV:412; BA:56 |
| R58 | *bulk* | `oz` is split into `us_fl_oz` and `imp_fl_oz`, and a person says which one a house already on `oz` means. | Infer it from the market | RV:417; BA:57 |
| A7 | "Door asks first (Recommended)" | A delivery for an item whose unit nobody has confirmed is asked about before it is booked. | "Book, freeze the guess", "Book, fix later" | TX 03:24Z; MEM:57 |
| R8 | *bulk* | Lot cost is kept per ml at `numeric(14,6)`, and the container price stays on the document line. | `cost_total` per lot; `container_cost` per lot | RV:146; BA:123 |
| R7 | "One wine at a time (Recommended)" | Row-level `uom` and a CLAIMS guard ship first. Each wine then moves to ml once it is sized, using the 750/150 interim. After a production count, the interim is dropped. | "No stand-in", "Convert all now as 750 ml" | RV:140 |
| R34 | *bulk* | Existing wine rows count as unit-confirmed and are marked legacy, so their alerts keep firing. Their par stays in bottles until R7 converts each wine. | Silence every wine alert until a person confirms it | RV:289; BA:45 |

### Group 3: sizes and formats

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Bottle sizes | "if same exact identical drink but just different size one item all size, try to mkatch based on product prices after osme time, or just research" | An identical drink is one item across all its sizes, and each size is a format. | "One item per size (Recommended)" | TX 03:27Z; MEM:60 |
| R3 | *bulk* | One shared `house_item_formats` arc table holds ml/g/each and `container_type`. | A format table per kind; a soft `format_id` | RV:116; BA:104 |
| R4 | *bulk* | Trade identities attach through a `format_identity_links` link table, so one format can carry several identities. | One identity per format; one identity per item | RV:122; BA:112 |
| R5 | *bulk* | Library ids sit on the format, and the item-level id stays as "primary". Each kind links to at most one catalogue, and duplicates go to a person. | Item level only | RV:128; BA:113 |
| R21 | *bulk* | `format_id` is NOT NULL for new lots. Legacy wine is exempt by a marker that is not designed yet, and batches mint their own format. | Nullable everywhere; batches carry `container_ml` | RV:216; BA:150 |
| R22 | *bulk* | Size proposals go in a new arced `house_item_size_proposals`. | Reuse `beverage_identity_candidates`; proposed rows in the format table | RV:221; BA:151 |
| R35 | *bulk* | A format's size is confirmed by a printed size, the door, invoice `format_ml`, the TR menu, a catalogue identity or a person. Kegs need a person or the door. A printed size that differs from the mapped format proposes add-a-size and never restates it. | A person only | RV:294; BA:34 |
| R36 + R37 | "Split by risk (Recommended)", one pick for both. The question asked who can accept "'add a new size' or 'these two are the same drink'" (TX 2026-10-02T16:24Z). | R36: a person, acting on a proposal, confirms that two sizes are one drink (RV:301 records it as (a)). R37: staff may confirm adding a size. Owner or manager confirms anything with price evidence, and every merge. Receipts into a size added by staff wait for a second look. | R36: (b) auto-confirm on an exact family key with ABV and vintage agreeing, and (c) owner or manager for all. Neither was offered as a live option. R37: "Owner or manager only", "Staff for all". | RV:300, :305 |
| R38 | "Price backs up a name match (Recommended)" | Price per ml only supports a name or family match and never proposes one alone. The 2-source, 4-week threshold is a placeholder. | "Price alone can propose", "Ignore price" | RV:311 |
| R39 | "Retire + correct (Recommended)" | A size found wrong after stock exists is fixed by retiring the format, adding the correct one, and posting compensating ml per lot. | "Edit in place" | RV:317 |
| R40 | "Keep one, move stock (Recommended)" | Two items with history merge by superseding one, moving stock with transfer pairs, and appending new mappings. | "Never merge" | RV:323 |
| R41 | *bulk* | A menu that lists several sizes is carried as one item with N formats, confirmed in the same step. | Carry N items and merge later; fold automatically | RV:329; BA:35 |
| R42 | *bulk* | Each existing POS "bottle" mapping is pinned to its only format. New ambiguous lines queue. | Largest or most-sold format; queue all | RV:334; BA:21 |
| R51 | *bulk* | ı/İ are folded and size words stripped in the TypeScript name cleaning, with the SQL key untouched. Sized names join the test set. | Fix the SQL key and the Python mirror together; leave it | RV:380; BA:36 |
| R52 | *bulk* | The size parser becomes kind-aware: kegs of 1 to 1,200 L, the `-lik` form, and bare numerals only for kinds where that is safe. False-strip tests come with it. | Raise `MAX_BOTTLE_ML`; no change | RV:386; BA:37 |
| R59 | *bulk* | The house names an order format. Until it does, the most-received format of the last 90 days is proposed; 90 days is a placeholder. | Cheapest per ml; last ordered | RV:422; BA:58 |
| R27 | "House decides per beer (Recommended)" | Draw order: the serve's `draw_format_id`, then an open lot, then the largest format, then FIFO, with earliest use-by first. Draft and bottled versions of a beer default to two items, and a person may join them. | "Always one item", "Always two items" | RV:251 |

### Group 4: serves and prices

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Glass sizes | "hopuse per kind you give default  otherwise" | The house declares serve sizes per kind. Where it has not, Mudavym gives a default, narrowed by R31 below. | "House per kind, line can differ (Recommended)", "Per item", "Per menu line only" | TX 03:27Z; MEM:58 |
| Serve price | "both" | Prices are kept per (item, serve ml), and named single/double serves exist too. | — (both options taken: "Price per serve size (Recommended)" and "Add single/double") | TX 03:27Z; MEM:59 |
| R9 | *bulk* | Serve rows carry their ml, stamped when the serve is created. `pour_events` gets `serve_id`, and the price key gets an `ml_source`. | Names resolve to ml at sale | RV:152; BA:18 |
| R10 | "Old prices rule until sized (Recommended)" | Prices move to an `item_sale_prices` arc table. Today's wine price columns stay authoritative until a key exists, and the seed names a person. | "Copy now as 'size unknown'", "House re-prices them" | RV:158 |
| R11 | *bulk* | Price, version and lock are keyed by (item, serve_ml) or (item, format_id). Open wine locks are re-keyed in the migration, with a skip-and-report list. | A FK to a serve row; lock kind `serve` | RV:164; BA:19 |
| R23 | *bulk* | `menu_price_versions` is widened with the new key, but only after the readers that assume one price per wine are swept. | A new `item_price_versions`, with the old table frozen | RV:226; BA:152 |
| R25 | "Confirm the set first (Recommended)" | When X19 switches a kind on, the house sees Mudavym's default sizes for that kind on one screen and confirms or edits them. Until then, those sales wait in the queue, so nothing depletes on a size nobody saw. | "Deplete, then ask", "Queue until they declare" | RV:239 |
| R30 | "From the house's country (Recommended)" | Defaults come from `restaurants.country`. Its values have not been queried yet. | "Ask at onboarding" | RV:268 |
| R31 | "Hold until researched (Recommended)" | Wine, liquor, rakı/anise and draft get a low-confidence default set. Liqueur/vermouth, sake and soft drinks by the glass get **no default** until researched; their serves are held by name, and their sales wait until the house states a size. This narrows "otherwise Mudavym gives a default" for those three kinds. The research is owed. | "Default by analogy now", "No general set at all" | RV:273 |
| R32 | "25 ml, house confirms (Recommended)" | The UK single is pre-filled at 25 ml and confirmed by the house under R25. | "Ask, no pre-fill", "35 ml in Scotland/NI" | RV:279 |
| R33 | *bulk* | The standard serve applies only when a serve is created and in displays. Every till button names a serve. | Also at the till, for a bare "glass" | RV:284; BA:20 |
| R43 | "Own price, else unpriced (Recommended)" | A double has its own price row; without one it is unpriced. | "Twice the single", "Same price per ml" | RV:339 |
| R44 | *bulk* | A serve that is sized but unpriced, sold at the till, depletes, is valued at the price charged, and is flagged. | Queue; value at a derived price | RV:344; BA:22 |
| R45 | "What was charged (Recommended)" | A POS line is worth its realized price, including 0. Failing that, it takes the house price, else null. | "Always the list price", "Bottle price (today)" | RV:349 |
| R46 | *bulk* | A person maps each POS modifier once, and lines with unmapped modifiers queue. Three points stay unsettled (see below). | One button per serve; also multiply effects | RV:354; BA:23 |
| R47 | "One screen to sort them (Recommended)" | When a house re-declares a measure, one action lists every price, lock and mapping on the old ml for a person to sort. | "Old prices go quiet", "Prices follow" | RV:360 |
| R53 | *bulk* | Menu import extracts one row per printed price, with an optional size and serve word. This amends ADR 0186. | Nested `serves[]`; keep the two price fields | RV:391; BA:38 |
| R82 | "Optional per kind (Recommended)" | Kinds may set optional margin targets. Cocktails use the pour target until one is set. | "Same targets everywhere", "Required before advice" | RV:533 |
| R83 | "Not now (Recommended)" | No happy-hour prices for now. | "Build time-window prices" | RV:538 |
| R84 | "Not now (Recommended)" | No legal checks on price or serve disclosure until the first TR onboarding. | "Advisory per market" | RV:542 |
| R85 | *bulk* | A "House red" button points at whichever wine is the house red today, and a person re-maps it when that changes. | A house-red pointer now | RV:546; BA:28 |
| R87 | *bulk* | A post-mix serve keeps its cup size as the price key, and a person states the `draw_ml`. | The syrup dose as `serve_ml`; wait for recipes | RV:555; BA:29 |
| R89 | "Money on lines only (Recommended)" | Deposits are recorded only as money on document lines. | "Count the empties", "Full refund workflow" | RV:565 |

### Group 5: till and voids

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Draft | "Kegs; voids return volume (Recommended)" | Draft counts in kegs of a stated size. The option text said: "Supersede B19 so a void returns the poured volume for every container; this also fixes wine's known-wrong void." | "Kegs; volume voids non-bottles", "Kegs; keg voids go to review", "Count draft in ml" | TX 23:47Z; MEM:19 |
| X2 | "unit glass and it derives from keg?", then "Yes, exactly that (Recommended)" | The keg is received and counted as a beer item with unit keg. The till sells a glass that takes its ml from the open keg. There is no draft table. | "Beer with unit keg (Recommended)" and "Its own draft table" (first round); "Glass is the stock unit" (second round) | TX 03:17Z, 03:18Z; MEM:50 |
| A8 | "Queue it, take nothing (Recommended)" | A sale whose size or unit is unconfirmed, or that has no stock booked, queues and takes nothing. | "Take it in the guess" | TX 03:24Z; MEM:57 |
| X19 | "Per house, per kind (Recommended)" | The till starts taking stock one house and one kind at a time. | "Per kind, everywhere", "All kinds at once" | TX 03:33Z; MEM:64 |
| R26 | "Take to zero, name the gap (Recommended)" | When stock is short at a sale, the book goes to zero and the rest is named as variance, with a feed entry. A8 still covers unconfirmed items. | "Queue it, take nothing" | RV:245 |
| R29 | "A person, count covers it (Recommended)" | A person resolves queued lines. Lines older than a count are marked "covered by count" and are not replayed. | "Auto-replay" | RV:263 |
| R49 | "Cap, name the excess (Recommended)" | A void returns to the sale's lot, else the open container, capped at its size. The excess shows as named variance. | "Queue it for a person" | RV:370 |
| R50 | "One action, keep or waste (Recommended)" | A keg kicked early or swapped mid-service is closed by one named action that keeps or writes off what is left. | "Wait for a count" | RV:375 |
| R86 | "One tap as waste (Recommended)" | A person states each draft line's volume, and one tap books line cleaning as waste. | "Leave it to the count", "A fixed loss %" | RV:550 |
| R92 | *bulk* | When a served form and a batch form share one POS name, the menu mapping decides which one is booked. The known gap is noted below. | A staff "built by hand" mark | RV:580; BA:30 |

### Group 6: counts and par

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| Alerts (lock review C16) | "Every kind, par in ml (Recommended)" | Every kind gets low-stock alerts, with par in ml. | "Wine only for now" | TX 03:27Z; MEM:61 |
| R6 | *bulk* | Lots are never deleted: a used-up lot stays at 0 with a depleted status. Pour and ledger rows carry `lot_id` with a real FK. This ships as its own PR before any format or batch PR. | Keep only lots with a run or use-by; keep deleting and stamp `format_id` | RV:134; BA:114 |
| R19 | *bulk* | Four ledger fixes ship together after R6: the `stock_counts` cascade, the last ml below one measure, a record of how a sale decomposed, and idempotency keys for draws across several lots. They ship in D3. | — | RV:206; BA:136 |
| R28 | *bulk* | A count posts per format line, as of its `counted_at`, with a location. | Zero every lot and book one; item level only | RV:257; BA:42 |
| R56 | *bulk* | Each kind counts an open container by its team's method, and a shared count RPC that accepts open ml lands in D3. | — | RV:407; BA:46 |

### Group 7: batches and recipes

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| A11 | "carry + pices + So this is a highly detailed sector. What I want you to do is I will send you a link to a website and I will want you to analyze this website. It's how it behaves through um, the recipes. So other than that, there will be batch cocktails as well. Prepared beforehand, there will be batch lemon juices, for example, batch simple syrups. Um, you know, we have to create edge cases for those. https://beverage.runsophra.com/dashboard/recipes" | Drinks are carried and priced now. Batches (cocktails, lemon juice, syrups) need edge cases. The Sophra recipes analysis is owed, and he signs in himself. | The options were "Carry + price now, recipes later (Recommended)" and "Recipes take stock now"; he answered in his own words | TX 03:33Z; MEM:63 |
| R60 | "Record only, for now (Recommended)" | A batch run records run, inputs, yield, cost and use-by. No lot moves until the shared ledger lands and he switches it on. | "Move stock now" | RV:429 |
| R61 | "Under 'House prep' (Recommended)" | Batches and preps live in `cocktail_items` as forms `batch` and `prep`, labelled "House prep". | "Their own 'Prep' kind", "Under the main ingredient" | RV:435 |
| R62 | *bulk* | Each prep has a `stock_mode` of `stocked` or `count_only`. Tracking applies only after the R60 switch-on (BA:74). | All stocked; all count-only | RV:440; BA:74 |
| R63 | "No guess, queue it (Recommended)" | A cocktail's serve volume comes from the item serve, then the recipe's per-serve figure, else the sale queues. Mudavym never guesses. | "Guess from IBA recipes" | RV:445 |
| R64 | "Juice is House prep (Recommended)" | House juices are preps. A lemonade that is sold is a soft drink that uses the prep. | "Soft drinks, uncounted", "Both count it" | RV:451 |
| R66 | *bulk* | Food used as an input before food is designed goes on a typed "food not set up yet" line. | Block it; point at `restaurant_inventory` | RV:461; BA:76 |
| R67 | "No, make a new one (Recommended)" | A cocktail's form cannot change once it has sales or stock. | "Change it, with a record" | RV:466 |
| R68 | *bulk* | Yield rates come only from the house's own runs, shown as "your usual". | Market defaults | RV:471; BA:77 |
| R69 | *bulk* | An unmeasured yield is credited at the recipe card's yield and marked provisional until a count. This applies after the R60 switch-on (BA:78). | Refuse the run; compute it | RV:475; BA:78 |
| R71 | *bulk* | At expiry, a person is offered a one-tap discard, a new named action. | Book waste automatically | RV:484; BA:80 |
| R72 | *bulk* | Topping up is only for items flagged top-up-able. A combine act sets use-by to the earliest of the sources. This applies after the R60 switch-on (BA:81). | Always; never | RV:489; BA:81 |
| R74 | "Ask first (Recommended)" | A run whose input is short or unconfirmed asks before it runs. | "Take to zero, note gap", "Refuse the run" | RV:499 |
| R75 | *bulk* | Corrections are appended, never edits. A run can be voided only while none of it has been drawn. | Delete and re-log | RV:503; BA:82 |
| R76 | "Ingredients only (Recommended)" | Batch cost is ingredients only. | "Add a labour rate" | RV:508 |
| R77 | *bulk* | Co-products are recorded at cost 0 and not stocked. | Split the run's cost | RV:512; BA:83 |
| R78 | *bulk* | A multi-day run takes its inputs at start and credits the batch when done, once R60 is switched on. | Take the inputs at done | RV:516; BA:84 |
| R79 | "The 14 legal groups (Recommended)" | Allergens use the 14 legal groups. This depends on the G5 Annex II PR. | "Free text" | RV:520 |
| R80 | *bulk* | A keg the house fills itself follows beer's keg rules. | A special container type | RV:524; BA:85 |

### Group 8: life values

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| R91 | "Approve the teams' set (Recommended)" | Each kind team's pick applies, with no built-in default for any life value. Wine open-bottle days are typed by a person, together with the opened date. | "Allow style defaults" | RV:575 |
| R65 | *bulk* | The rule "default otherwise" does not reach shelf life or yield; a person types or measures them. | Mudavym defaults | RV:456; BA:75 |
| R70 | *bulk* | Shelf life is typed in hours by a person. | Days | RV:480; BA:79 |
| R73 | "Take it and flag it (Recommended)" | An expired lot at sale is drawn and flagged. | "Block it" | RV:494 |

### Group 9: ML and research

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| R93 | "Wine-only for both (team draft)" | **Not the live option labelled "(Recommended)"**; see §Bulk for which recommendation it differs from. Two parts of the product become wine-only: its per-house ML extraction, and its per-item research queue. The queue is `claim_house_item_research`, at `20261116101200_house_item_research_is_worked_by_the_enrich_chain.sql:118`. It **must** refuse every non-wine item. That refusal is not built: the function has no kind filter at `a823ef32d`, and D4 builds it. The ruling covers this extraction and this queue, and nothing else. | "ML wine-only, research not closed (Recommended)", "Don't record a boundary" | RV:585; BA:97; FK:675-679 |

The ML half restates his scope words in group 1 ("only the wine items are
extracted for ML"). The research half is new with R93.

**R31 and R93 name different research** [Answered 2026-10-02, round 15. This was
a reading, put to him in the lock PR. He picked *"Yes, different research (Recommended)"*:
"R93 keeps the per-house queue and ML wine-only. Mudavym still researches cited market defaults for every kind, and until they land, those three kinds have no default."
He did not pick "No, both wine-only" (R15:25-27; TX 03:29Z).] A peer session read
the two as a conflict. This record read them as two separate pieces of research,
and he confirmed that reading:
- **R31's owed research** is Mudavym's own market-default research, with a cited
  source for each default.
  - It is written as rows of `serve_size_defaults`. That table is owned by
    Mudavym and read-only to houses, and every row carries a `source_url` (RV's
    `ml-and-serves.md:443` and `:458-475`; ML-6 at `:734-742`).
- **R93** binds only the product's per-house ML extraction and the per-item
  research queue `claim_house_item_research`.
  - Sources: FK:675-679, and `20261116101200_house_item_research_is_worked_by_the_enrich_chain.sql:118`.

So R93 does not stop the market defaults for non-wine kinds from being researched.
Until that research lands, liqueur/vermouth, sake and soft drinks by the glass
have no default (R31).

### Group 10: schema plumbing

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| A1 | "One checked link per kind (Recommended)" | Every referencing row carries one nullable FK per kind table, with exactly one set (an exclusive arc). The option text included "Wine stays in today's table, with no rows moved". | "Kind + id, trigger-checked", "Re-pick one id + per-kind" | TX 03:17Z; MEM:49 |
| A2 | "One book, rows name kind (Recommended)" | One stock book (lots, movements, counts, pours), whose rows say which kind's table they point at. | "A stock book per kind" | TX 03:18Z; MEM:53 |
| A5 | "One-time exception (Recommended)" | Drinks misfiled as wine move once, in one migration that lifts the guard only inside itself, skips and flags what it cannot move, and runs last, after a production count. | "Retire and re-create", "Leave them as wine" | TX 03:18Z; MEM:54 |
| R12 | *bulk* | A moved drink carries a confirmed unit only where its old row counted bottles. Its size is kept as a proposal, par is not carried, and soft and hot lines stop minting wine-library rows. This runs through R7's conversion, before any size proposals. | A per-kind variant | RV:170; BA:90 |
| R14 | *bulk* | Real FKs, `ON DELETE RESTRICT`, on the six soft reference sites. The wine arm stays NOT VALID until an orphan count. | Arms with no FK | RV:181; BA:131 |
| R15 | *bulk* | Tenant-scoped composite FKs, after the `restaurant_id` backfill. | Single-column FKs only | RV:186; BA:132 |
| R16 | *bulk* | Generated `(item_kind, item_id)` reader columns. | Thirteen partial uniques and OR filters per reader | RV:191; BA:133 |
| R17 | *bulk* | A gateway PR names the constraint in every `restaurant_inventory` embed, and a CI grep refuses reads that do not (PGRST201). | Replace the wine FK | RV:196; BA:134 |
| R18 | *bulk* | Measure insert speed on the hot ledgers first, then put arcs everywhere unless the cost is unacceptable. | A single pair with a trigger guard | RV:201; BA:135 |
| R20 | "Widen now, rename owed (Recommended)" | `wine_consumption_log` is widened to point at any kind. Renaming it is owed, in its own PR. | "Widen and rename now", "New kind-neutral log" | RV:211 |
| R24 | *bulk* | The guard blocks PRs on a fresh database build and runs nightly against production as an advisory, once invariant 4 is fixed. G1's kind-table guard blocks and is mutation-tested. | Blocking on production | RV:232; BA:153 |

### Round 15: the lock PR's forks answered

After the lock, the forks this record filed as OD-218 to OD-222, and its reading of
R31 against R93, were put to him in two batches. R15 quotes his picks, and TX is the
primary record.
- Batch 1 was asked at 2026-10-03T00:05Z and answered at 03:01Z: OD-218 to OD-221.
- Batch 2 was asked at 03:02Z and answered at 03:29Z: OD-222, R31 against R93, wine
  F4 and cider F10.
- In his time zone (UTC-4) that is 20:05 to 23:29 on 2026-10-02.

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| OD-218 | "Approve teams, ask 2 (Recommended)" | Each kind team's pick in FK:2357-2376 is approved; the table below lists them. Three are not the team's pick. Wine F4 and cider F10 were asked on their own (rows below). Cocktails F4 "is recorded as answered by your R81 (tenths of a ml), because the team's pick would round to whole ml". Four sub-parts were not asked in round 15; round 17 answered them ("Round 17" below). | "Ask each one", "Leave open until each kind's PR" | R15:5-7; TX 03:01Z |
| OD-219 | "Design + attack first (Recommended)" | Three more kind teams design `non_alcoholic`, `food` and `supply`, and each design is attacked "before any kind PR merges". It costs "about 3 team passes and 2-3 PRs". "Units keep mg and kg", so AR:238's sketch, which kept only g, ml and each, does not stand. | "Thin tables now" | R15:9-11; TX 03:01Z |
| OD-220 | "Both kinds (lean)" | "Indexes configured" means both kinds. One is the per-house filter indexes that every read uses. The other is the uniqueness rules: one row per library item, one per declared item, and the low-stock partial uniques. This was this record's lean, not a team recommendation; the team gave none because these were his words. | "Uniqueness rules only" | R15:13-15; TX 03:01Z |
| OD-221 | "Server looks it up (Recommended)" | A count queued offline with a bare id reaches its table because the server finds that id across the kind tables. This covers counts already queued and old phone builds. It relies on ids being unique across kinds, which uuids are. | "App adds the kind" | R15:17-19; TX 03:01Z |
| OD-222 | "Keep /spirits (Recommended)" | Under X3 only the visible labels change. The `/spirits` address (`apps/web/src/App.tsx:415`) stays. | "Rename + redirect", "Rename, no redirect" | R15:22-24; TX 03:29Z |
| R31 vs R93 | "Yes, different research (Recommended)" | He confirmed the reading in the R93 row above. The per-house queue and the ML stay wine-only, while Mudavym researches cited market defaults for every kind. Until those land, liqueur/vermouth, sake and soft drinks by the glass have no default. | "No, both wine-only" | R15:25-27; TX 03:29Z |
| Wine F4 | "Item has vintage (Recommended)" | As today, the wine item is the library row, wine plus vintage, so a new vintage is a new item. Each lot records the vintage it arrived with, and the door flags a mismatch. This is the kind team's option 1. | "Vintage only on the lot", "Item + substitution rules" | R15:28-30; TX 03:29Z; FK:2357 |
| Cider F10 | "A list of bases (Recommended)" | Each cider, mead or seltzer item lists 1 to 4 alcohol bases from a fixed set, so a pyment (honey plus grape) fits. This is the kind team's (b), a `text[]` with an element CHECK. | "One base, combos added", "Drop it" | R15:31-33; TX 03:29Z; FK:2364 |

**The twenty kind-local forks.** "Approved" means the kind team's pick, quoted from
FK. Each fork's options are in section 6 of its kind file, under
`/Users/aldemirkonuk/Projects/p4-scratch/drink-tables-2026-10-01/kinds/`.

| Kind | Fork | Answer | What it means | FK |
|---|---|---|---|---|
| Wine | F4: is vintage part of the item or of the lot? | Asked on its own; see "Wine F4" above | — | 2357 |
| Wine | F14: the `restaurant_inventory` columns marked DROP | Approved: "Option 2, gated on the per-call-site count. The POS id columns move to pos_item_mappings with the shared team." | The columns are dropped and their values derived, but only after each call site is rewritten. Nobody has counted those call sites yet (`wine.md:1157-1167`). | 2358 |
| Wine | F15: the wine-only satellites | Approved: "Option 2. The retirement is a separate decision." | The satellites with readers (`wine_consumption_log`, `auction_lot_records`, `house_item_research`) are repointed. The three with no reader are not retired by this. | 2359 |
| Wine | F23: should future sealed documents carry the container size? | Approved: "Option 1, consistent with the founder's 'sealed documents unchanged'." | No. Seals do not change, and the size lives on the posting record. | 2360 |
| Beer | F-MATCH: the receiving matcher cannot read cl or lt | Approved: "(a). '33 cl' and '1 LT' are how the real Turkish price list writes sizes." | The matcher's size regexes learn cl, lt and the decimal comma, plus a can-or-bottle word. A regression pack over wine fixtures and Efes strings comes with it. | 2361 |
| Draft | F-D3: build `house_tap_lines` now? | Approved: "(a). (c) can follow without a schema change." | Yes, minimal: label, coupler, line volume, connected keg, last cleaned, and the house's cleaning interval. | 2362 |
| Draft | F-D5: how foam and yield loss enter stock | Approved: "(a)." | A pour depletes its nominal serve. Loss shows as count variance, and yield is used only in reports. | 2363 |
| Cider | F10: the alcohol-base shape | Asked on its own; see "Cider F10" above | — | 2364 |
| Sake | F8: refuse a JP label whose polishing contradicts its NTA grade? | Approved: "A. Caveat: the 2011 source; the 2022 amendment's effect on grades was not checked." | Yes, for Japanese origin only. The caveat stands: nobody has checked the 2022 amendment. | 2365 |
| Rakı | F9: Turkish fiscal tracking | Approved: "A now, B with the first Turkish house." | None now. A bandrol yes/no at the door comes with the first Turkish house. | 2366 |
| Rakı | F12: what '½ btl' is, and the smallest container | Approved: "C, with no default; the importer creates no row either way. (b): the 20 ml floor stays until he names the smallest bottle." | Each house is asked at the confirm step, and either a smaller bottle or a half pour is allowed. The importer creates no row. The 20 ml floor stays until he names the house's smallest bottle. | 2367 |
| Cocktails | F1: where a house's cocktail stock lives | Approved: "(a)." | In its own table with child tables. `public.cocktails` stays the reference recipe book. See the readings below. | 2368 |
| Cocktails | F4: how fractional spec ml become ledger quantities | Answered by R81, not by the team's pick | Spec ml book in tenths of a ml (R81). The team's cumulative rounding to whole ml is not adopted. | 2369 |
| Cocktails | F9: should the menu propose a spec? | Approved: "(a) now, (b) next." | Not now: staff type a spec or copy it from the recipe book. Proposing a draft spec from the menu comes next. | 2370 |
| Cocktails | F11: pour cost's price basis and target | Approved: "(c). The 18-24% band was not confirmed for cocktails in its cited source (review fix 14)." | Pour cost uses the price without KDV, taken from dated KDV bands. There is no default target until the house sets one. | 2371 |
| Cocktails | F12: how long spec versions are kept | Approved: "(a). It is now load-bearing: as-of-closedAt resolution (F23) and audits need retired versions." | Forever; versions are write-once. | 2372 |
| Cocktails | F17: what happens to `public.cocktails` | Approved: "(a). The standing founder rule (memory mudavym-finish-goal-2026-09-16) is never to delete tables or rows, so (b)'s retirement conflicts with it. (c) double-counts." | It stays as a read-only reference to copy from. Writes to /cocktails, `countCocktails` and the catalogue union move to the house table. | 2373 |
| Cocktails | F23: which spec version a late sale uses | Approved: "(a). It matches what the bartender poured, and it needs F12 (a)." | The version that was active when the check closed. | 2374 |
| Soft drinks | SD22: may a made-in-house drink carry a carafe price basis? | Approved: "A." | No. A made-in-house drink is never unit-confirmed by a menu basis, so a carafe price is just a price. | 2375 |
| Hot drinks | HD-13: doses that are not whole grams (phase 2) | Approved: "A while phase 1 has no depletion. Revisit B only if HD-3 widens and variance shows it matters." | A draw is whole grams, so a person picks 7 or 8 for a 7.5 g coffee. | 2376 |

**Three overlaps, read in plain words.** These are this record's readings, not his
answers. In each, the approved team pick fits an earlier ruling of his.
- **Cocktails F1 and R61 name one table.** F1 gives a house's cocktail stock its own
  table and keeps `public.cocktails` as the recipe book. The kind team called that
  table `house_cocktails`; under R13 it is `cocktail_items`, and DR:51 maps one name
  to the other. R61 puts batches and preps in that same table, as forms `batch` and
  `prep` under the "House prep" label (RV:435-437).
- **Cocktails F11 sets the price basis, and R82 sets the target.** F11 says pour cost
  uses the price without KDV, and that Mudavym gives no default target. R82 lets a
  house set an optional cocktail target, and uses the house's pour target until it
  does (RV:533-536). That pour target is the house's own setting, with "no default,
  no backfill" (`serve-prices.md:469`). So a cocktail is judged only once the house
  has set one of the two, which is what F11 asks. R82 states a target as a margin and
  F11 as a pour cost; on the same price, each is 100% minus the other.
- **Beer F-MATCH and R52 change two different parsers.** R52 widens `parseVolumes` in
  `apps/api-gateway/src/vendor-intel/bottle-size.ts` (`MAX_BOTTLE_ML` at :154) for
  kegs, the `-lik` form and kind-gated bare numerals (RV:386-389). F-MATCH widens the
  receiving matcher's own regexes at
  `apps/api-gateway/src/procurement/documents/line-matcher.ts:121-125`. Those read `ml`
  and `l`, `ltr`, `liter` or `litre`, so "33 cl" and "1 LT" never match there. Both
  rulings stand. Whether the matcher calls `parseVolumes` instead of keeping its own
  regexes is a code choice for that PR.

### Round 17: OD-218's four sub-parts answered

Round 15 did not ask four sub-parts of OD-218. They were put to him on 2026-10-03.
RQ17 quotes his picks. TX is the primary record and holds each option's full text,
which is quoted below.
- Batch 1 was asked at 2026-10-03T14:27Z and answered at 14:56Z. It covered HD-12,
  the register list, wine F21b and the POS shapes. His HD-12 answer was free text
  and picked no option, so a clarifier followed.
- The clarifier was asked at 14:58Z and answered at 20:15Z.
- In his time zone (UTC-4) that is 10:27 to 16:15 on 2026-10-03. RQ17:3 says
  "about 10:50" for the asking; the times here are TX's.

| # | Pick (verbatim) | What it means | Rejected | Source |
|---|---|---|---|---|
| HD-12, first answer | Free text: "by ingrident type I mean it has ice then its cold no? option 2 is better demonstration or just keep it Drinks" | Not settled; it picked no option. The clarifier below put his two ideas, temperature ("option 2" was "By temperature") and one "Drinks" kind, against stocking by ingredient. | — | RQ17:5-11; TX 14:56Z |
| HD-12 | "Stock by ingredient, menu Hot/Cold (Recommended)" | The option read: "Coffee, tea, cocoa, salep and herbal are stocked in one kind, so the beans are one item. On the menu and the till, every served drink shows as Hot or Cold, and anything with ice is Cold. Iced latte shows Cold and uses the same beans." So the hot-drink kind is defined by ingredient, and an iced coffee draws from it. Hot or Cold is a serve attribute, not a kind. | "By temperature everywhere", "One 'Drinks' kind" | RQ17:33-37; TX 20:15Z; FK:797-803 |
| X13 register list | "Sake register, cider chip (Recommended)" | The option read: "Sake gets its own register, switched on once stock exists. Cost: one migration and one card. Cider/mead/seltzer starts as a filter chip and gets a register once a house carries more than a handful. The chip ships with cider's base list so it is never empty." Liqueurs already have the eighth register (the X3 follow-up), so sake's is the ninth. | "Both get registers now", "One shared 'other drinks'", "Chips only for both" | RQ17:13-15; TX 14:56Z; FK:1732-1762 |
| Wine F21b | "Keep today: not counted (Recommended)" | The option read: "A low-stock alert means 'low on the shelf'. Cost: an ordered wine keeps alerting until it arrives, so people may wonder why something already ordered still shows." Stock that is ordered but not delivered stays out of low stock, as `v_low_stock_items` keeps it out today (baseline :6048). | "Count what is on order" | RQ17:17-19; TX 14:56Z; FK:1693-1699 |
| X19 POS shapes | "Approve all; R46 covers mods (Recommended)" | The option read: "Take the eight team picks: flights queued for now; Toast line id in the duplicate-sale key; Coravin counted as an open bottle; mixed buckets queued; a glass from a packaged beer queued; cider table shipped dark first; sake behind a shared resolver first. Cocktail modifiers use the same R46 mapping, so the till has one modifier mechanism, not two." It says eight and lists seven. The eighth shape, modifiers, takes R46's mapping, not the cocktail team's pick. The table below gives each shape. | "Approve all; cocktails buttons-only", "Ask me each case", "Decide at each till PR" | RQ17:21-31; TX 14:56Z; FK:2106 |

**X19's eight shapes.** "Approved" quotes the kind team's pick from FK.

| Shape | Fork | Answer | What it means | FK |
|---|---|---|---|---|
| Flights | Wine F16 | Approved: "Option 1 now, and option 2 if the house sells flights." | A flight or multi-wine line queues with the reason `multi_component` and depletes nothing. A child table of mapping components waits until the house is known to sell flights, which nobody has checked. | 2116-2122 |
| Toast duplicate-sale key | Wine F17 | Approved: "Option 1." | The Toast line guid (or index) joins the idempotency key, and `toast_item_guid` moves into `pos_item_mappings` with a backfill. Two lines of one wine on a check stop collapsing into one depletion. At this branch's head three app files name `toast_item_guid`: `apps/api-gateway/src/inventory/inventory.service.ts`, `apps/api-gateway/src/toast/toast.service.ts` and `apps/web/src/services/api/inventory.ts`. | 2124-2129 |
| Coravin | Wine F18 | Approved: "Option 1 until the house is known to use Coravin." | A Coravin pour books from an ordinary open lot. Open-life alerts may fire early on an argon-protected bottle. | 2131-2136 |
| Buckets | Beer F-BUCKET | Approved: "(a) at launch, then (b) if the house sells mixed buckets." | A single-beer bucket depletes by `units_per_sale` on its mapping. A mixed bucket goes to the unresolved queue and is handled by hand. | 2138-2143 |
| A glass from packaged beer | Beer F6 | Approved: "(a)." | The till queues it as unresolved, and the menu line stays carried and unconfirmed. Nothing on the menu is refused. | 2145-2150 |
| Cider ship order | Cider F12 | Approved: "(b)." The team marked it "Founder call", and this pick is his call. | The cider table ships dark first, and no FK path reaches it. G1-G7 follow, and the first stock-holding row waits for them. | 2152-2158 |
| Sake till rollout | Sake F15 | Approved: "A." | A shared resolver and queue for pos-hub, Toast and manual pours come first, then the database backstop, then sake POS mappings. No sake POS depletion happens until all three land. Whether the live house uses Toast is not checked. | 2160-2166 |
| Modifiers | Cocktails F6 | Answered by R46, not by the team's pick | The team's pick was "(c), building only (a) now", one POS button per variant. His pick maps cocktail modifiers, such as premium gin and pitcher, the way R46 maps doubles and sizes: a person maps each modifier once, and lines with unmapped modifiers queue. No POS adapter delivers modifiers at this branch's head: `apps/api-gateway/src/pos-hub/pos-types.ts` has no modifier field, and no file under `pos-hub` or `toast` names one. | 2176-2182 |

**Round 17, read in plain words.** These are this record's readings, not his
answers.
- **The hot-drink kind keeps R1's code value.** R1 and X1 named the kind
  `hot_drink`. His round-17 pick says what the kind holds and says nothing about
  that value, so `hot_drink` stands. The kind's visible name is not settled (see
  "Left open").
- **Iced coffee lines are no longer held.** HD-12's team wrote "Until decided, iced
  and liqueur lines are held (routing step 5)". An iced coffee now routes to this
  kind as a Cold serve. Liqueur coffee lines stay held, because their menu home is
  still open (see "Left open").
- **The cider chip's condition.** His option said the chip "ships with cider's base
  list so it is never empty". The kind team's condition at FK:1738 is cider F4:
  "Either way it ships with F4, or the chip is empty (review probe G)". F4 is the
  ADR 0186 vocabulary amendment. It teaches the classifier 'ciders', 'mead',
  'hard seltzer' and 'elma şarabı', which classify as unknown today. It is not cider
  F10's list of bases (round 15), which does not change what the classifier finds.
  This record reads his pick by its stated purpose, a chip that is never empty: the
  chip ships with F4's members, inside the ADR amending 0186 (§Build order, "Records
  owed"). The wording he saw named a different fork, so this reading is listed under
  "Left open" to be confirmed with him.

### Still open — not decided by any of the above

Nothing this record filed is still open. OD-219 to OD-222 were answered in round 15,
and OD-218's last four sub-parts in round 17. All five are marked resolved in place
in `OPEN-DECISIONS.md`. The details under "Left open inside answered rulings" are
not new forks, and each is settled before the build step that needs it.

### Left open inside answered rulings

These are not new forks. Each answered ruling above names a detail it did not
settle, and each detail is settled before the build step that needs it.

- **Placeholders:**
  - R38's 2 sources and 4 weeks (RV:311).
  - R59's 90 days (RV:422).
- **Follow-on choices:**
  - R60: whether runs move stock is a follow-on choice, made only on his switch after the shared ledger lands (RV:429).
  - R53: a wine line that prints two prices needs a rule (RV:391).
- **R46's three unsettled points:**
  - modifiers that arrive by name only;
  - which wins when a modifier and the button's ml disagree;
  - replay (BA:23).
- **Unsolved or not yet designed:**
  - R11: a format re-size still orphans its price (RV:167).
  - R75: a yield typo found after draws needs a revaluation path (RV:503).
  - R15: rows that cannot be backfilled have no stated treatment yet; the step-0 count sizes the problem (RV:186).
  - R21: the legacy-wine marker is not designed (RV:216).
- **Conflicts and known gaps:**
  - R23 conflicts with AR:263-264 until the readers are swept (RV:226).
  - R92's known gap: a hand-built drink, made while the batch jug is not empty, books from the jug (BA:30).
  - R88 and R64 overlap on juice.
    - R88 sends "fresh juice" to soft drinks (RV:561).
    - R64 makes house juices preps, with a sold lemonade a soft drink that uses the prep. RV:454 records that "the soft-drinks team has not agreed".
    - No ruling says where a bought-in juice ends and a house-made juice begins. It is settled before K1-K6 draws the soft-drink and prep boundaries.
  - R49: the waste mark comes later (BA:26).
- **Details inside round 15's approvals:**
  - Cocktails F4 under R81: a drop is less than a tenth of a ml. The team's rider,
    "with dashes and drops cost_only per (b)", was not asked on its own. How a
    quantity below a tenth books is settled before the cocktail K-PR (FK:2369).
  - Cocktails F9's "(b) next" reads the menu's description and ingredients to propose
    a draft spec. Whether that is the per-house ML extraction R93 keeps wine-only is
    settled before (b) is built.
  - Rakı F12 (b): the house's smallest bottle is a fact he gives, and the 20 ml floor
    stays until he does (FK:2367).
  - Wine F14:
    - the per-call-site count that gates the drops has not been taken;
    - two of the columns record what a person did (`glasses_per_bottle_override` and
      the `last_manual_edit_*` trio), and the standing rule never to delete tables or
      rows does not name columns.
    Both are settled before the F14 PR.
  - Wine F15: retiring the three satellites with no reader is a separate decision.
    The standing rule is never to delete tables.
  - Sake F8's caveat: the 2022 amendment's effect on grades is checked before the
    sake K-PR (FK:2365).
- **Details inside round 17's answers:**
  - HD-12, the kind's visible name. The option he picked names no label. The
    first-round option that would have made the chip read 'Coffee & tea' was not
    the one he picked, and "One 'Drinks' kind" was rejected. Settled before the
    hot-drink K-PR.
  - HD-12, liqueur coffee's menu home. Its stock follows the ingredient either way:
    beans from this kind, liqueur from liqueurs. HD-12's option B made it a cocktail,
    and the option he picked does not say. Its lines stay held until this is
    settled, before the hot-drink K-PR.
  - HD-12, how far Hot and Cold reach. His option says "every served drink shows as
    Hot or Cold", and the question was about coffee and tea. Whether a beer or a wine
    serve carries the mark is settled before step S adds the attribute.
  - The register list:
    - the cider chip's condition, read above as cider F4's vocabulary, is confirmed
      with him;
    - "more than a handful", the point where cider gets its register, has no number
      and no one named to call it.
    Both are settled before cider's register PR.
  - X19's modifiers: R46's three unsettled points (above) now cover cocktail
    modifiers too. No adapter delivers modifiers yet, so R46's mapping has nothing to
    read until one does. That adapter work is owed
    (`.planning/tech-debt.d/2026-10-02-docs-adr-0115-drinks-lock.md` item 14).

## Build order (2026-10-02), migrations first

His lock pick asked for this plan: "plan the build migrations-first (lots first,
tenths of a ml before recipes)". Only two of its constraints are his words:
- lots first (M1);
- tenths of a ml before recipes (M3 before any recipe explosion).

Everything else in this section is this record's proposal, and he can change it.
That covers the other steps and their order, M2's placement and M3's placement
before D1, the gates, and the PR sizing. The step names follow AR §5 and §6.

**Rules for every step.**
- Each step aims at one PR of 15 files or fewer, unless AR §6 already splits it.
  A step whose sweep is larger, such as M1, splits into several PRs.
- AR's file counts are estimates that nobody censused.
- Migrations auto-apply on merge, so a step that cannot prove its data is safe
  skips and flags. It never raises.

| Step | What it does | Rulings | Gated on | Unblocks |
|---|---|---|---|---|
| 0 | **Production counts.** This is a query step, not a migration. It runs:<br>• the lock review's §7 queries (LRV:358-366) and AR's step 0;<br>• the number of wines with no size (R7);<br>• rows that cannot be backfilled (R15);<br>• the size of the misfiled-row repair (R12, A5);<br>• the `restaurants.country` values (R30);<br>• production's Postgres and PostgREST versions. R16's generated columns need `SET EXPRESSION` (PG17+), and R17's PGRST201 behaviour comes from the PostgREST docs and was not run (BA:133-134).<br>None of these has been run. | R7, R12, R15, R16, R17, R30, A5 | Supabase access, which this session did not have | R7's second half; the D0 flag list; the R30 defaults; D7 and D8 |
| M1 | **Drained lots are kept** (own PR). The shared write path stops deleting a used-up lot (`20260912163000_a_stock_write_names_its_house.sql:240-244`). The lot stays at 0 with a depleted status, and pour and ledger rows carry `lot_id` with a real FK. RV:138 recommends it "as its own PR in D3 before any format or batch PR". It comes first here because his lock pick says "lots first" and because it touches only tables that exist today. **Size:** RV:137 says it "sweeps 41 non-migration files and 21 migrations that mention `inventory_lots`". So M1 is likely several PRs, kept apart from every other step. | R6; R19 and R49 depend on it | none | every format PR; every batch PR; R39; R49's void to the sale's lot; D3 |
| M2 | **Ledger rows state their unit.** This ships ADR 0070's `uom NOT NULL` on every ledger row (`0070-a-quantity-states-its-own-unit.md:76-78`). It is **not shipped**: the only `uom` column added so far is the item-level one (`20260903171000_the_house_item_is_the_ledgers_key.sql:277`), and `inventory_lots`, `inventory_transactions` and `pour_events` have none. The same step adds R7's CLAIMS grep guard on `stock_live` and on `?? 750` (now at `inventory.service.ts:80`). | ADR 0070; R7 (first half) | none | M3; R7's per-wine conversion; R34 |
| M3 | **Tenths of a ml.** The volume base unit becomes a tenth of a ml: "a finer base unit", so quantities stay integers under ADR 0070, which asks for a vocabulary "fine enough at the outset" (`0070-…:157-158`). It comes before D1, so the generated kind tables carry the unit from the start, and before any recipe explosion. | R81; R48 rides on it | M2 | D1; any recipe explosion; R48's multiplication at the till |
| PR-00 | **Embed hints.** This is a gateway PR with no migration. Every `restaurant_inventory` embed names its constraint, and a CI grep enforces it. It must be live in production before D2. | R17 | none | D2 |
| D0 | **Tenant keys are never null.** Backfill `restaurant_id` and set NOT NULL, lock-safe. Rows that cannot be backfilled are flagged; their treatment is still open. | R15 | step 0's count | D1 |
| D1 | **One table per kind.** This adds:<br>• the registry and the kind derivation function (G1, G6);<br>• generated `<kind>_items` tables, with one Turkish fold and `deleted_at`;<br>• the `kind` CHECK widened to fourteen values (`hot_drink`);<br>• on every kind table, the OD-220 indexes: per-house filter indexes, and the uniqueness rules (one row per library item, one per declared item, and the low-stock partial uniques);<br>• a unit vocabulary that keeps `mg` and `kg` (OD-219).<br>Rakı is a family in `spirit`, not a table. An item whose kind nobody can tell is held for a person. G1's guard blocks and is mutation-tested. | R1, R13, R2, X1, X3, A12, R24 (the G1 half), OD-219 (units), OD-220 | D0, M3 | D2 |
| D2 | **Every reference names its kind.** This adds:<br>• 32 arcs;<br>• `ON DELETE RESTRICT` FKs, with the wine arm NOT VALID until the orphan count;<br>• tenant composite FKs;<br>• generated `(item_kind, item_id)`.<br>The insert benchmark on the hot ledgers comes first. `wine_consumption_log` gets its arc columns here. | A1, R14, R15, R16, R18, R20 | D1; PR-00 live in production | D3; the formats step |
| F | **Formats.** This adds:<br>• `house_item_formats` and `format_identity_links`;<br>• library ids on the format;<br>• `house_item_size_proposals`;<br>• the kind-aware size parser and the ı fold.<br>`format_id` becomes NOT NULL for new lots only once the legacy-wine marker is designed. | Bottle sizes, R3, R4, R5, R21, R22, R35-R42, R51, R52, R59 | M1, D2 | D3's per-format posting; serves and prices; R7's conversion |
| D3 | **The ledger takes a kind.** One stock book, with these rules:<br>• R19's four fixes;<br>• short stock goes to zero and the gap is named;<br>• counts post per format, as of `counted_at`, through a count RPC that accepts open ml;<br>• a void returns volume to its lot, capped (this supersedes B19);<br>• the keg-kicked action and the line-cleaning tap. | A2, R19, R26, R28, R29, R56, Draft, X2, R49, R50, R86 | D2, M1, F | D3b; D4 |
| D3b | **The door reads every unit.** `can` and `bag_in_box` become container types, pieces count as `each`, and the door converts g, kg and ml. The door asks before booking an item whose unit is unconfirmed, and `oz` is split. | Count unit, R55, A7, R58 | D3 | the carry PRs |
| S | **Serves and prices.** This step adds:<br>• serve rows stamped with ml and `item_sale_prices`, where legacy wine prices rule until a wine is sized;<br>• locks re-keyed, with a skip-and-report list, and price versions widened after the reader sweep;<br>• per-kind default sets, with the market taken from the country. When a kind is switched on, the house confirms or edits its set, and until then those sales wait in the queue (R25);<br>• no default for liqueur/vermouth, sake and soft drinks by the glass. R31's research is owed, but it is not a gate: S ships without it, and those three kinds stay without a default until it lands;<br>• a Hot or Cold mark on serves, where anything with ice is Cold (HD-12, round 17). How far the mark reaches beyond coffee and tea is settled first (§2026-10-02, "Left open"). | Glass sizes, Serve price, R9-R11, R23, R25, R30-R33, R43-R47, R53, R54, R82, R85, R87, R89, HD-12 | F, D3; step 0 (R30); the ADRs amending 0186 and 0193 (below) | till PRs (X19) |
| D4 | **Prices, research and lookups take a kind.** D4 builds the R93 refusal: `claim_house_item_research` must refuse every non-wine item. It has no kind filter at `a823ef32d`. | R93 | D3 | the orchestrator PR |
| D5 | **Views read every kind.** `house_items` becomes a UNION ALL. `v_low_stock_items` is rebuilt with a LEFT JOIN, gated on a confirmed unit and a stated par. Stock in transit stays out of low stock, as today (wine F21b, round 17). | Alerts (lock review C16), R34, wine F21b | D4 | none |
| D6 | **Kind tables keep house rules.** This adds the unit freeze once stock exists, and `move_house_item_kind` with its audit table. It lands before any carry PR. | Count unit (freeze), A14 | D5 | every gateway carry PR |
| K1-K6 | **Typed DDL per kind.** This covers:<br>• the kind boundaries;<br>• the beer style table, with only `other` until BJCP permission;<br>• allergens, after the G5 Annex II PR;<br>• life values typed by a person;<br>• cocktail forms `batch` and `prep`, which cannot change once used;<br>• each kind's approved kind-local picks (round 15), including wine F4's vintage on the item with lot vintage flagged at the door, and cider F10's list of bases;<br>• the hot-drink kind by ingredient: coffee, tea, cocoa, salep and herbal, with iced serves drawing from it (HD-12, round 17);<br>• the cider table shipping dark first; its first stock-holding row waits for G1-G7 (cider F12 (b), round 17). | R88, R90, R79, R91, R65, R70, R61, R67, OD-218 (approved picks; HD-12 and cider F12, round 17), OD-219, OD-220 | D6; the three OD-219 designs, each attacked, before any of these merges; for the hot-drink PR, the kind's visible name and liqueur coffee's menu home (§2026-10-02, "Left open") | the gateway PRs; batches |
| B | **Batches, record-only.** A run records its inputs, yield, cost and use-by, and moves no stock until he switches it on. | A11, R60, R62-R64, R66, R68, R69, R71-R80 | K (cocktails) | runs that move stock: a follow-on choice of his |
| G, W, Mo, Or | **App PRs.** Gateway (ledger callers, POS, receiving, carry, menu carry, procurement, pricing, analytics), web, mobile and orchestrator. The gateway finds a bare item id across the kind tables, so counts queued offline still land (OD-221). The web changes only the visible "Spirits" labels and keeps `/spirits` (OD-222). Round 17 sets the rest:<br>• the till PRs carry X19's approved shapes. Flights, mixed buckets and a glass from packaged beer queue. The Toast line guid joins the idempotency key, and `toast_item_guid` moves into `pos_item_mappings`. A Coravin pour books from an open lot. Cocktail modifiers use R46's mapping, which needs an adapter that delivers modifiers;<br>• sake's till path lands as shared resolver, then database backstop, then sake mappings (sake F15 A);<br>• the web adds a ninth register, sake, switched on once a house has sake stock, and a cider chip that ships with cider's vocabulary (F4, in the ADR amending 0186). | X14, Menu unit, R41, R42, X19, A8, R25, R46, R92, OD-221, OD-222, OD-218 (round 17) | K1-K6; the X14 amendment (this ADR); for the cider chip, the ADR amending 0186 and the confirmation listed under "Left open" | wine to ml; D7 |
| Wine | **Wine moves to ml one wine at a time.** Each wine converts once it is sized, with the 750/150 interim. After a production count, unsized wine queues instead. | R7, R34, R12 | M2, F, step 0 | D7 |
| D7 | **Misfiled rows move once, last.** The guard is lifted only inside this migration. Rows it cannot move go to a review table. | A5, R12 | every app PR live; step 0 measured | D8 |
| D8 | **VALIDATE** the wine-only CHECK at a measured zero. | — | D7's review table at zero | none |

**Records owed before the code that needs them.**
- This ADR is the amendment for the per-kind ruling, the A forks and X14.
- An ADR amending 0186 for the menu vocabulary and one row per printed price
  (R53, R54), before S. Its vocabulary includes cider F4's members, which the
  cider chip needs (round 17).
- An ADR amending 0193 for serve-level prices and locks (Serve price, R10,
  R11), before S. AR §6 names this amendment.
- The library-kind mapping that R2 says is "recorded in an ADR", before D1.
- An OPEN-DECISIONS entry for every fork still open. None is: OD-219 to OD-222
  (round 15) and OD-218 (round 17) are marked resolved in place.
- The three designs OD-219 asks for (`non_alcoholic`, `food`, `supply`), each
  attacked, before any K-PR merges.

**Not in the order.**
- The `wine_consumption_log` rename (R20) is owed as its own PR, any time after
  D2. It is filed in `.planning/tech-debt.d/2026-10-02-docs-adr-0115-drinks-lock.md`.
- Wiring the CI guard (R24) waits on the invariant 4 fix and is filed in the
  same place.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | Aldemir (founder) | Identity axis decided: **one house item id across all beverages** |
| 2026-09-03 | Design pass | Blast radius measured from `pg_constraint` on production; four unenforced ledger references found that a migration-grep and an FK sweep both miss |
| 2026-09-03 | Adversarial pass | H1 (a new `house_items` table) killed on its dual-write window after being the leading shape; H2 killed on four independent grounds; H3's own relaxation measured in a full local build (112 migrations, 0 failures) rather than reasoned |
| 2026-09-03 | — | Created — **Proposed**. Migration written and NOT applied; founder locks |
| 2026-09-04 | Migration proof | Applied inside a transaction and rolled back, against a local build of all 114 other migration files (0 failures, the file under test excluded as the control). Proven: the three `DROP NOT NULL`s take; the four new columns are `NOT NULL` with **0 defaults**; `house_items` is `security_invoker` and unreadable by `anon`/`authenticated`; both partial uniques exist; the §8 probe leaves no rows. Against seeded wine rows: the backfill fills `display_name` from the library for a blank `wine_name`, maps `unit_type='CASE'` to `uom='case'`, the legacy insert path still derives `wine`/`bottle`/`wine_library`, a declared keg keeps `beer`/`keg`, a duplicate keg name and an unknown `uom` and a both-catalogues row are each refused, and **a non-wine lot writes and projects `stock_live = 4`**. Negative control: a pre-existing row with a NULL `master_wine_id` makes §0 refuse the whole migration |
| 2026-09-04 | Guard | `scripts/check_house_item_invariants.py` written and proven: exit **2** on the unmigrated control and on an unreachable database, **1** on a stock row naming a house item that does not exist, **0** on a correct one; `--self-test` also catches a reintroduced `DEFAULT`, an inconsistent provenance, a view that lost `security_invoker` and a stored house key, inside one rolled-back transaction. Not wired into CI: the migration is gated, so a blocking guard would fail every build |
| 2026-09-04 | Aldemir (founder) | **Three sub-decisions taken.** (a) The library link becomes `ON DELETE RESTRICT`; soft-delete is the only retirement path; the refusal names the count; a link to a retired wine is flagged, never cascaded; and phase 2 gains a producer, "a wine your house stocks was retired from the library", naming the rows (design only). (b) A house item exists **only** through an explicit "carry this" that also sets kind and unit — menu and invoice lines that match nothing stay unmatched and say so, never auto-created. (c) The first enrichment writer funded is **beer style and IBU**, written by the house at carry-time with a picker and by the catalogue where a match exists. Questions 1 and 3 close; question 6 (the style vocabulary) opens |
| 2026-09-04 | Aldemir (founder) | **Beer style vocabulary settled: the BJCP list with an `other` escape.** An off-list style is typed as free text, stored under `other`, and flagged for the catalogue; style sorts and filters, and `other` sorts last. The escape is what makes a closed list survivable — without it an operator is forced to file a real beer under a wrong style, and a wrong style is indistinguishable from a right one downstream where `other` announces itself. Question 6 closes; phase 2 item 7 is unblocked on vocabulary |
| 2026-09-04 | Aldemir (founder) | **Phase 2 fixes the receiving door in the same dispatch.** ADR 0070's leftover — no mass unit at intake, `@IsInt()` rejecting 4.5 — lands together with the beverage rows' stock cards, as one named dispatch with both regressions tested separately. The reason it cannot wait: shipping the stock cards alone would put `kg` on a house item while leaving a receiver unable to book a flour delivery. Re-measured on the day: the intake vocabulary has **zero** mass units and lives in **three** places, not one (`20260805000000:4401`, `:4593`, and inlined at `20260901150000:106`) — all three move or a line the invoice accepts is one the receipt refuses; and `@IsInt()` appears **98 times across 21 DTO files**, so ADR 0070's "15" is the quantity subset and must be re-derived rather than trusted. Question 5 closes |
| 2026-09-04 | Aldemir (founder) | **The `kind` vocabulary ships whole.** All thirteen values, `food` and `supply` included, with the beverage kinds used first — a CHECK that already admits `food` costs nothing until a row uses it, where widening it later is a migration against live rows at the moment the bakery work is trying to move. The note states that **only the beverage kinds have readers today**, so the CHECK admitting a kind is never read as a claim that a surface can render it. Question 2 closes; no change to the migration, whose CHECK already carries all thirteen |
| 2026-09-04 | Delegated, decided here | **No phase-3 rename; the `house_items` view settles the noun permanently.** The founder delegated question 4 on premortem, future technical change, scalability and cleanliness, and all four agree. Premortem: a 199-call-site mechanical rename whose only failure mode is a missed site reading a table that no longer exists — silent at write time, surfacing as absent data, this repo's named cardinal fault, bought in exchange for a nicer name. Future change: the view already gives every future reader the right noun at zero risk. Scalability: unaffected either way — same rows, same indexes, no materialisation and no write path. Cleanliness: one name in code and one in the schema that the view maps beats a rename that still leaves 88 migration files, the production baseline and every archived note saying the old one. **Reopen only if the noun leaks into a public API or a partner contract** — and by then the view is there to rename behind, which is the cheap order. Phase 3 amended: it drops the two legacy columns and renames nothing. Question 4 closes, and with it every question on this ADR |
| 2026-09-04 | Retirement measurement | Taken before changing the FK, so the cost is known: `master_wine_library.deleted_at` exists and is exercised (**664 of 4 226** soft-deleted); **zero** live database functions hard-delete from `master_wine_library` — `merge_library_wines()` was converted by `20260817120000:3,15` and the two remaining `DELETE` lines in the tree are in superseded bodies; **199** distinct library wines are stocked and **0** of them are retired. So RESTRICT breaks no path that exists |
| 2026-09-04 | Re-proof | Migration re-applied in a rollback transaction on a rebuilt control (114 other migrations, 0 failures). `confdeltype = 'r'`; the refusal trigger is attached; an **unstocked** wine is still deletable, so RESTRICT does not make wines immortal; the §8 probe proves a stocked wine cannot be hard-deleted, that the refusal names "1 house item row(s) across 1 house(s)", and that retiring it leaves the house item live. Guard extended to invariant 7 and re-proved: exit **1** on a persisted dangling-link fixture (all three parts reported), exit **0** with a `FLAGGED` line on a persisted retired-wine fixture, and 10 of 10 self-test probes green |
| 2026-09-04 | Correction | Invariant 1 said "four of those five" have no foreign key. Re-measured: it is **four of eight**, and the five named were the wrong denominator — `inventory_lots`, `stock_counts`, `pos_item_mappings` and `wine_consumption_log` all DO carry an `inventory_id` FK; the four without one are `inventory_transactions`, `pour_events`, `inventory_alert_state` and `inventory_lot_revaluations`. Fixed in place, per ADR 0025 |
| 2026-10-01 | Lock review | `/Users/aldemirkonuk/Projects/p4-scratch/adr-0115-lock-review-2026-10-01.md`: phase 1 found applied (PR #289, 2026-09-12); claims C2, C3, C16 and C22 overturned by evidence, and C14, C19, C23 and C24 found stale or failing (bracketed here on 2026-10-02). Its §7 production queries were not run |
| 2026-10-01 | Aldemir (founder) | "Lock + reopen wrong bits (Recommended)", then "A separate table per kind" and the other picks recorded in §2026-10-02 (UTC 2026-10-01T23:01Z to 2026-10-02T04:10Z) |
| 2026-10-02 | Aldemir (founder) | R1-R93 answered in eleven batches. Batch 11, "Approve all as recommended (Recommended)", locks this ADR as amended (see Status). R48 differs from the written recommendation, and R93 from the live "(Recommended)" label (see §2026-10-02, Bulk) |
| 2026-10-02 | Amendment, branch `docs/adr-0115-drinks-lock` | §2026-10-02 and §Build order added; conflicting older text bracketed in place and dated, not rewritten; OD-113 marked resolved; OD-218 to OD-222 filed; owed work in `.planning/tech-debt.d/2026-10-02-docs-adr-0115-drinks-lock.md` |
| 2026-10-02 | Aldemir (founder) | Round 15 (UTC 2026-10-03T00:05Z to 03:29Z) answered the lock PR's forks. OD-218 "Approve teams, ask 2 (Recommended)"; OD-219 "Design + attack first (Recommended)"; OD-220 "Both kinds (lean)"; OD-221 "Server looks it up (Recommended)"; OD-222 "Keep /spirits (Recommended)"; R31 vs R93 "Yes, different research (Recommended)"; wine F4 "Item has vintage (Recommended)"; cider F10 "A list of bases (Recommended)" |
| 2026-10-02 | Amendment, same branch | §2026-10-02 "Round 15" added; the R31/R93 reading marker turned into his answer; OD-219 to OD-222 marked resolved in place; OD-218 narrowed in place to four sub-parts |
| 2026-10-03 | Aldemir (founder) | Round 17 (UTC 2026-10-03T14:27Z to 20:15Z) answered OD-218's four sub-parts. HD-12 "Stock by ingredient, menu Hot/Cold (Recommended)", after a free-text first answer and a clarifier; register list "Sake register, cider chip (Recommended)"; wine F21b "Keep today: not counted (Recommended)"; X19's POS shapes "Approve all; R46 covers mods (Recommended)" |
| 2026-10-03 | Amendment, same branch | §2026-10-02 "Round 17" added, with its readings; "Still open" emptied; round-17 details added to "Left open"; OD-218 marked resolved in place; §Build order's OD-218 gates replaced by the answers (S, D5, K1-K6, G/W) |
