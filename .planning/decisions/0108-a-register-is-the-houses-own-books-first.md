# 0108 — A register is the house's own books first, and the catalogue second

- **Status:** proposed — built behind a flag, founder review open
- **Date:** 2026-09-03
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** cellar, beverages, register, house record, ledger, identity, OD-113, beverage_house_key, pos_unresolved_lines, soft drinks, cocktails, recipes
- **Links:** [[0044-mudavym-design-wave-4]], [[0042-iznik-seal]], [[0051-no-seeded-defaults]], [[0070-ledger-quantity]], `.planning/06-pages/DESIGN-FOUNDATION.md` §6 (`/cellar` row) and §6a, `.planning/06-pages/wines.md` §1b, `supabase/migrations/20260903120000_the_house_s_own_record.sql`, `apps/api-gateway/src/beverages/`, OD-113 (non-wine inventory identity)

## Context

`/cellar`'s six non-wine registers — beer, whisky, spirits, cocktails,
non-alcoholic, soft drinks — were built over `public.beverages`. That table has
no `restaurant_id` at all: read the `CREATE TABLE` at
`supabase/migrations/20260817070000_beverages_table.sql:217`. Nothing in the
schema references `beverages.id` except `cocktail_ingredients.beverage_id`
(`supabase/migrations/20260817090000_cocktails.sql:63`), a table created empty
on purpose (`…:20-25`) and still empty.

So the registers were honest and useless in the same breath. Measured live
against the dev gateway on 2026-09-03: `/whiskey` returned 272 rows, `/beer` 57,
`/spirits` 400 (capped), and every one of them was a stranger's bottle. The
surface said so — `registerShapes.ts` carried the sentence *"these are the
shared reference catalogue, not this house's stock"* — which converted a design
failure into a well-worded disclaimer. A whisky bar opening its own whisky
register saw nothing of its own.

Meanwhile `DESIGN-FOUNDATION.md` §6, the `/cellar` row, already named the
answer and marked it **now**: *"**The house's own record on every bottle** —
first bought, what we have paid, what we poured, when it ran out, who quoted it
… CellarTracker has 7.5M strangers' notes; we have one house's memory, which is
the brand thesis as data."*

That record exists. It is simply not joinable. Five tables carry a
`restaurant_id` **and** the product's name in text:

| The house fact | Table | Name column |
|---|---|---|
| what we list, and charge | `menu_items` | `name` + `producer` |
| what we were invoiced, and when | `procurement_document_lines` → `procurement_documents` | `description` |
| what we ordered | `procurement_order_items` → `procurement_orders` | `wine_name` + `producer` |
| who quoted it, off what | `vendor_price_observations` | `product_name_raw` |
| what we actually sold | `pos_unresolved_lines` | `item_name` |

The last one is the quiet discovery of this pass. `pos_unresolved_lines` holds
the till lines the POS bridge could not map to an inventory row — and since
`restaurant_inventory` is keyed on `master_wine_id`, **every non-wine sale a
house makes lands there and nowhere else**. It is not a defect log. For beer,
spirits and soft drinks it is the sales ledger.

What blocks the join is OD-113, the non-wine inventory identity axis, seen from
the reporting side: a house can buy, list, quote and sell a keg, and the
platform holds five unjoinable records of it.

## Options considered

1. **Leave the registers catalogue-first and wait for OD-113.** Costs nothing to
   build and keeps every existing sentence true. It also means `/beer`,
   `/whiskey`, `/spirits`, `/non-alcoholic` and `/soft-drinks` stay reference
   shelves indefinitely, since OD-113 is a schema decision with no date. The
   founder asked for "the four large builds"; this is the option that builds
   nothing.

2. **Match in TypeScript.** Read the five books through PostgREST, normalise
   names in the gateway, group. Works against the live database today with no
   migration — and creates a second implementation of an identity rule whose one
   home is deliberately the database. `20260819000000_guest_identity_minimal_slice.sql:255-257`
   states the rule outright: canonicalisation lives "in the database, so two
   call sites cannot compute identity differently — the same reason
   `beverage_identity_key()` is a database function and not TypeScript."
   Rejected on that sentence alone; the drift would be invisible and permanent.

3. **Reuse `beverage_identity_key` unchanged as the join key.** The right
   instinct, and it does not work. That key preserves the producer/name split,
   because for merging two catalogue rows the split is information. The five
   books record it five different ways: `menu_items` has a `producer` column,
   `procurement_document_lines` has one free-text `description`,
   `pos_unresolved_lines` has whatever the till was programmed with. So
   `beverage_identity_key('Lagunitas','IPA')` = `lagunitas||ipa` while
   `beverage_identity_key(NULL,'Lagunitas IPA')` = `||ipa lagunitas`: one
   product, two keys, and a cross-book record that never assembles.

4. **A similarity score — trigram, embedding, or a threshold on token overlap.**
   Would match far more. It would also attribute one house's spend to the wrong
   bottle silently, which is the failure mode this repo is least able to detect
   and least able to undo. `20260817070000_beverages_table.sql:150-160` records
   why the catalogue refused scores in the first place: an unrecognised token
   must always count as *discriminating*, so a gap costs a visible duplicate and
   never a silent merge. Rejected.

5. **A derived reporting key in the database, built from the existing
   tokenizer.** What was built. See below.

## Decision

**Invert the spine: a register is the house's own books first, and the shared
catalogue is the lookup laid over them — joined by a new REPORTING key,
`public.beverage_house_key()`, built from the existing `beverage_tokenize()` and
from nothing else.**

The key folds the producer into the name before tokenizing and returns the
sorted token multiset, so the five books agree. It is deliberately coarser than
`beverage_identity_key`, and the migration says so in its own header and asserts
it in a `DO` block: `beverage_house_key('Lagunitas','IPA')` must equal
`beverage_house_key(NULL,'Lagunitas IPA')`, must *not* equal
`beverage_house_key('Lagunitas','Pils')`, and must be NULL for text that
tokenizes to nothing.

Three properties carried the decision:

- **One tokenizer, one home.** There is no second EQUIV table, no second NOISE
  list, no threshold and no score. The coarsening is a single documented
  operation on the output of the existing function, so a change to
  `beverage_tokenize` reaches both keys at once and they cannot drift.
- **The weakening is bounded, stated, and confined to reporting.** The migration
  states that this key cannot tell a producer from a name and therefore does not
  inherit `identity_key`'s zero-false-merge property; it must never be written to
  a row, never used to merge or link, never substituted for `identity_key`.
- **The catalogue join has exactly two tiers, and the row says which.** `exact`
  (same token multiset) and `contains` (every catalogue token present in the
  house's line, e.g. "Lagunitas IPA" inside "LAGUNITAS IPA 6/12OZ NR"). There is
  no third tier. A house line reaching neither keeps its record with no
  catalogue entry — *a bottle nobody catalogued is not a bottle nobody bought* —
  and a `contains` row is labelled loose in the table and again on the reading
  stand.

Two consequences of the inversion are decisions in their own right:

**Soft drinks become a real register.** No value of `beverage_type` separates a
cola from a kombucha, so the previous build showed the ask instead of a number.
The house's menu and till name a cola perfectly well, so the register is now
served by the house's books alone, and the response says the catalogue was not
asked rather than that the read was empty.

**Cocktails get CRUD, and are the only register that does.** `public.cocktails`
is the one table here carrying a `restaurant_id` (`…20260817090000:28`), so it
is the only one a house can own. `public.beverages` gets no write path from this
module: a tenant inserting into a global reference catalogue whose identity is
set by trigger (`set_beverage_identity`) would be a second writer for somebody
else's table. That refusal is a sentence on the page, not a missing button.

Included in that: **`cocktail_ingredients` gets its first writer.** Every prior
version of this page repeated "recipes were never extracted, so this register
can list names and never a recipe" as though it were a property of the product.
It was a fact about the *extractor*. It was never a reason a bartender could not
type one.

**Stocking stays withheld, everywhere, with the reason on the wire.** Every
quantity path (`restaurant_inventory`, `inventory_lots`, `inventory_transactions`,
`pour_events`) is keyed on `master_wine_id`. The "Count into the cellar" control
is rendered, disabled, with the gateway's own `stocking.reason` string beside it,
carrying `decision: "OD-113"`. The gateway owns that sentence so the browser
cannot invent a cheerier one, and `available` is a literal `false` in the type,
so a future build cannot flip it without deleting the sentence next to it.

## Consequences

- **Easier.** A register answers "what do *we* pour", which is the question an
  operator opens it for. First bought, paid, poured and who quoted are on the
  row; the whole record opens on the reading stand naming the table each fact
  came from. Soft drinks and cocktails stop being apologies.
- **Easier later.** When OD-113 lands, the ledger already names every non-wine
  product this house touches, with its invoice history — which is most of the
  input a stocking migration would need.
- **Harder / given up.** A house whose books are thin sees a thin register; the
  catalogue rows are still there but are labelled as belonging to nobody. Cross-
  book grouping is exact-or-nothing, so two spellings of one bottle appear as two
  rows until somebody merges them — deliberate, and preferable to a score.
- **Given up: coverage.** `contains` will miss an invoice line that abbreviates
  ("LAG IPA 6PK"). The register shows it as the house's own row with no catalogue
  entry, which is true, rather than attaching it to a plausible neighbour.
- **A new cost.** `beverage_house_key` is a second key in the codebase. The
  mitigation is that it is *derived*, asserted, documented as reporting-only, and
  ungranted to browser roles — but it is a thing that can be misused, and the
  first misuse to watch for is somebody storing it on a row.
- **Revisit when:** OD-113 is decided (the register gains a real stock column and
  the ledger becomes a backfill source); **or** the `contains` tier is measured
  attributing a house's spend to the wrong bottle even once (drop to `exact`
  only — the tier is already reported separately in `counts.matchedLoosely` so
  the measurement is available without new instrumentation); **or**
  `beverage_house_key` is found written to any row, which is the abuse this ADR
  exists to forbid.

## Not decided here

- Whether a house may add a row to `public.beverages`. Left refused; it is a
  question about who owns the shared catalogue, which is OD territory.
- `/menu` as a surface. Settled separately and unchanged — do not build now
  (DESIGN-FOUNDATION §6a; `menu-scenarios-2026-09-03.md` §d). This register
  *reads* `menu_items` and never writes one, per that study's §b.3: the declared
  register set is Settings' job, and no other surface may hold a competing copy.
- Pricing or reorder from a beverage row. Out of scope; the seal stays rationed
  to the one purchase-order hold on `/wines`.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-03 | — | Created — built behind `mudavym_design_cellar`, founder review open |
