# 0119 — An agreed price states its unit

- **Status:** **Accepted — O1 phases 0, 1 and 2 built; 2026-09-04 and 2026-09-05.**
  Q1, Q5 (2026-09-04) and **Q2, Q3, Q4, Q6 (2026-09-05)** are answered by the founder.
  **Q7 alone remains open**, restated below. Phase 2 was built in two dispatches: the
  read side first (*"teach the list route the pair and show it on the rows; leave legacy
  as is"*), then the four decisions above — the header price made an echo the database
  enforces, the price series given a stated unit, the money outside the price given
  columns, and `split_case` turned from a vocabulary word into a rule. Phase 2's first
  half closed the read side: `GET /procurement/orders` joins the line's pair in the SAME query and the
  rebuilt ledger row prints the price with its unit, or the register's refusal when
  there is none. The ADR was written as research only ("No code, no migration, no schema
  change") and that is no longer true of it: phase 0's mail half shipped in `f7ae750e`,
  and on 2026-09-04 the founder chose *"ship the columns and the /orders field
  together"*, which built phase 1 — the migration
  `supabase/migrations/20260905010000_an_agreed_price_states_its_unit.sql`, the writers,
  and the price-unit control on `/orders`. What was NOT built is listed under
  "Still open after phase 1" at the end of the Recommendation. **The pair now lives on
  the SHARED web type (2026-09-05):** `priceUom` / `pricePackSize` were declared in a
  local `OrderWire` intersection in `pages/orders/next/useOrdersNextData.ts` because
  `services/api/types.ts` `Order` was known to be wrong; that type is now exactly
  `OrderResponseDto`'s key set, the intersection lost six keys to it, and
  `scripts/check_web_reads_gateway_dto_keys.py` fails CI if the two drift apart again.
  Auditing the other consumers found the phantom pair this ADR named was **nine** keys,
  not two, and that the ledger row's em dash had siblings: `"$0"` on the dashboard's
  approval seal, `"$NaN"` on the provider card, and a whole spend engine summing zeroes
  (`06-pages/orders.md` §13.16).
- **Date:** 2026-09-04 (researched) · 2026-09-04 (Q1/Q5 decided, phases 0-1 built) · 2026-09-05 (phase 2, the read side, built) · 2026-09-05 (Q2/Q3/Q4/Q6 decided and built)
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** agreed price, price unit, unit of measure, case price, bottle price,
  pack size, split case, deposit, allowance, freight, `procurement_orders.final_price`,
  `procurement_order_items.final_unit_price`, `price_history`,
  `vendor_price_observations`, `price_index_postings`, GS1, GTIN, price posting
- **Links:** `[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]` (Q6, the
  question this answers), `[[0115-the-house-item-is-the-ledgers-key]]` (phase 2 item 3a
  — the intake vocabulary in three places), `[[0070-a-quantity-states-its-own-unit]]`
  (the shape this borrows: an integer quantity beside a `uom NOT NULL`),
  `[[0011-pos-sale-volume-contract]]` (a unit that cannot be resolved is never guessed),
  `[[0108-a-register-is-the-houses-own-books-first]]`, `[[0020-no-fabricated-answers]]`,
  `.planning/06-pages/orders.md` §13

---

## Context

ADR 0117 built the price register's first fill — the house's own paper mirrored into
`vendor_price_observations` — and hit a wall it refused to guess past. On an order
placed in cases, the platform holds one number, `procurement_orders.final_price`, and
**nothing on the row says whether that number is a case price or a bottle price.** The
two readings differ by the pack size. A case price filed as a bottle price makes every
comparison that touches it wrong by a factor of twelve, silently, in the direction that
looks like a bargain.

So `confirmDeal` passes `packSize: bottlesPerConfirmedUnit === 1 ? 1 : null`
(`apps/api-gateway/src/procurement/procurement.service.ts:4778`, at `HEAD` =
`e8a7d6f5`), and `decideOwnPaperSighting` refuses a null pack size with a sentence
(`own-paper-sighting.ts:235-246`). The receipt path has no such gap: an invoice states
its own unit, and `toBottleOperands` has already resolved and already refused it
(`invoice-match.ts:350-426`).

**The refusal is wider than "we could not read the unit", and that width is the whole
argument.** It refuses a *known* pack of 12 exactly as firmly as an unreadable one —
because knowing that a case holds twelve bottles does not tell you which of the two the
price is quoted in. ADR 0117's own Q6 states it in those words. Any option that closes
this gap by reading the pack harder is answering a different question.

The founder's instruction on 2026-09-04: **"research. cover every angle."**

### What is actually measured, and where

Every number below was read on 2026-09-04 from the branch `feat/mudavym-design-p4` at
`e8a7d6f5`, or from the local Postgres, or from the migration/ADR that recorded it.
Sources are named per fact because they disagree in age.

**1. The invoice line already states its unit. The agreement does not.**

`procurement_document_lines` — the *invoice* line — carries, on one row:

| Column | Line in `20260805000000_baseline_from_production.sql` |
|---|---|
| `format_ml integer` | `:4385` |
| `qty numeric(12,3) NOT NULL` | `:4386` |
| `uom varchar(20) NOT NULL DEFAULT 'bottle'` | `:4387` |
| `pack_size integer NOT NULL DEFAULT 1` | `:4388` |
| `qty_bottles numeric(12,3) NOT NULL` | `:4389` |
| `free_goods_qty numeric(12,3) NOT NULL` | `:4390` |
| `unit_price numeric(12,4)` | `:4391` |
| `line_total numeric(12,2)` | `:4392` |
| **`allowance numeric(12,2)`** | `:4393` |
| **`deposit numeric(12,2)`** | `:4394` |
| `CONSTRAINT …_uom_check` (the seven singulars) | `:4401` |

`procurement_orders` — the *agreement* header — carries `quantity` (`:4520`),
`unit_type` (`:4521`), `bottles_total` (`:4522`), `quoted_price` (`:4523`),
`negotiated_price` (`:4524`), `final_price` (`:4525`), `total_cost` (`:4526`) and
`invoice_unit_price` (`:4559`). **None of the four price columns names a unit.** There
is no `allowance`, no `deposit`, no freight column.

`procurement_order_items` — the *agreement* line — carries `quantity` (`:4485`),
`unit_type` (`:4486`), `bottles_per_unit` (`:4487`), `total_bottles` GENERATED as
`quantity * bottles_per_unit` (`:4488`), `quoted_unit_price` (`:4489`),
`negotiated_unit_price` (`:4490`), `final_unit_price` (`:4491`) and `line_total`
(`:4492`). So the agreement line states the unit of its **quantity** and nothing about
the unit of its **price** — while the invoice line beside it states both.

**2. The convention exists, and it is enforced by arithmetic rather than by the
schema.** Three places assert per-bottle without a column that says so:

- `procurement.service.ts:469` — `totalCost = dto.totalCost ?? finalPrice * bottlesTotal`,
  where `bottlesTotal = quantity × bottlesPerUnit`.
- `procurement.service.ts:819-821` — `line_total = finalPrice × units.bottlesTotal`,
  written into `procurement_order_items.line_total` on the same row whose `unit_type`
  says `case` and whose column is named `final_unit_price` (`:842-843`). **A reader
  seeing `unit_type = 'case'` beside `final_unit_price` will read "price per case". The
  arithmetic means "price per bottle." Nothing on the row settles it.**
- `procurement.service.ts:976` — `price_history.unit` hardcoded `"BOTTLE"`, with the
  docblock at `:921-928` recording that all callers pass a per-bottle figure.

**3. The convention leaves the building, and on a case order it leaves wrong.**
`confirmDeal` emails the vendor:

> ``…confirm our order: ${quantity} bottles of ${wineName}${priceLine}``
> (`procurement.service.ts:4810`), where ``priceLine`` is
> `` ` at $${finalPrice} per bottle` `` (`:4804-4806`)

and `quantity` is `opts.quantity ?? order.quantity` (`:4701`) — which is the order's
count **in the order's own `unit_type`**. On an order of 5 cases of 12, that sentence
says *"5 bottles … at $X per bottle"* when the order is 60 bottles. One sentence, two
unit claims, and on a case order the first is wrong by the pack size and the second is
an assertion the schema cannot back. This is outbound mail; it reaches a vendor.

**4. The register has already been taught to demand a stated unit — for public prices
only.** A peer session shipped `price_index_postings`
(`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`) on
2026-09-04 for ADR 0117's classes B/D/E. Its price is stated as a **quadruple**:
`price` (`:92`), `price_unit VARCHAR(24) NOT NULL CHECK (btrim(price_unit) <> '')` (`:96`)
described in its own comment as *"'per package', 'per bottle', 'per case'. Named, not
assumed, so a per-case price is never read as a per-bottle one"* (`:94-95`), `pack
INTEGER CHECK (pack IS NULL OR pack > 0)` (`:99`), and `size_value`/`size_unit`
(`:88-89`). It also holds `container_charge` **outside** the price for a posted deposit
(`:103`) and `price_basis NOT NULL` for the trade level (`:75`). **So the house has
already decided that a class-B/D/E price states its unit, in a table shipped the same
day. Class A — the house's own agreed price — has not.** That asymmetry is this ADR's
whole subject.

**5. Row counts.** *Local Postgres* (`supabase_db_exzueerziesmczwlhomd`, port 54322),
queried 2026-09-04: `procurement_orders` **0**, `procurement_order_items` **0**,
`procurement_document_lines` **0**, `price_history` **0**, `vendor_price_observations`
**0** — so `select unit_type, count(*) from procurement_orders group by 1` returns
**zero rows**, and there is no local distribution of orders by unit to report.
**Caveat, stated because it changes what the local DB proves:** that container's
`supabase_migrations.schema_migrations` tops out at `20260805155901`, so its schema is
the baseline plus five early migrations and it does **not** carry
`procurement_orders_unit_type_check`. Any claim about a constraint must be read from the
migration file, not from that database. *Production*, from the notes: 2 orders / 1 order
line / 0 documents / 0 `price_history` on 2026-09-01
(`20260901150000_order_line_capture_and_units.sql:5-10`); 1 `procurement_order_items` row
and 0 `vendor_price_observations` on 2026-09-04 (ADR 0115 §Context table; ADR 0117
`:44-47`). **There is no legacy data on this axis on any measured surface.** A migration
here is free in the exact sense migration `20260901150000` used the phrase.

**5a. Why every citation above names `HEAD` and not the checkout.** The worktree
`wt-p4` is shared and was being edited by another session while this research ran:
`git status` showed `own-paper-sighting.ts` and `own-paper-sighting.spec.ts` modified but
uncommitted, and line numbers moved under a second read of the same file. So every
`file:line` here was re-read from `git show HEAD:<path>` at `e8a7d6f5` rather than from
the working copy. One observation from the working copy, recorded because it is a real
thing seen and not mine to fix: the uncommitted spec has grown from 14 `it()` blocks at
`HEAD` (which is the count ADR 0117's review trail claims) to 21, and one of them —
`priceBelowAverage over own-paper rows` — **fails** with
`skipped.unrecognisedClass: 1`. That is another session's work in flight, not a
regression at the tip, and **no git state was changed to find out** (per the standing
rule after the stash incident); the finding is reported, not acted on.

**6. The unit vocabulary is seven words, in three places, with no mass unit.**
`{bottle, case, keg, pack, split_case, each, liter}` at
`20260805000000_baseline_from_production.sql:4401` (invoice lines), `:4593` (receipt
events), and inlined a third time at `20260901150000_order_line_capture_and_units.sql:106`
— re-measured and recorded by ADR 0115 phase 2 item 3a. `ORDER_UNIT_TYPES`
(`order-units.ts:63-71`) is the code half; `MULTIPLYING = {case, pack, split_case}`
(`:74-78`); `OPAQUE = {keg, liter}` (`:81`). Any price-unit vocabulary this ADR proposes
inherits all three copies and the same "all three move or none does" rule.

**7. `normalizeUnitPrice` treats a 12×375 as identical to a 6×750.**
`vendor-price-consensus.ts:129-141`: `perUnit = price / pack`, then
`volumeAdjusted = perUnit × (750 / unitVolumeMl)`. For $X per case of 6×750 that is
`X/6`; for $X per case of 12×375 it is `(X/12) × 2 = X/6`. Volumetrically correct,
commercially false — a half-bottle is not half a bottle in trade, and GS1 gives the two
packs different GTINs (below). This is a property of the reader, not of the register,
and it is out of this ADR's scope, but it is on the same axis and is recorded here so it
is not discovered later as a surprise.

---

## How the trade actually states a price

Every claim in this section carries a URL. Two of the reference vendors (MarginEdge's
and Toast's help centres) serve `403` to this environment's fetcher for some articles;
where that happened the fact came from the search index over the same URL and is marked
**[index]** rather than **[fetched]**. A source we could not fetch is recorded as
unverified, never as unavailable — ADR 0117's rule, applied to itself.

### Per bottle, per case, and the two are not related by division

Connecticut defines the posted bottle price in statute, and it is **not** the case price
divided by the pack:

> *"'Bottle price' means the price per unit of the contents of a case, other than beer,
> and determined by dividing the case price by the number of units or bottles making up
> the case and adding at least the following amounts based on the size of the bottle:
> two cents for bottles one-half pint or two hundred milliliters or less; four cents for
> bottles more than one-half pint or two hundred milliliters but not more than one pint
> or five hundred milliliters; and eight cents for bottles larger than one pint or five
> hundred milliliters."*
> — Connecticut General Assembly, OLR report 2004-R-0593 **[fetched]**
> <https://www.cga.ct.gov/2004/rpt/2004-R-0593.htm>

New York treats the unit of a price as a first-class attribute that a discount attaches
to: *"Only one unit of measure (bottle or case) is to be discounted per product in any
given month."* — NY State Liquor Authority, Price Posting **[fetched]**
<https://sla.ny.gov/price-posting>

Twelve of the 38 US licence states require wholesalers to post prices to retailers, and
a posting names the container size, the number of containers per case, and the price per
case **and** per bottle. — Alcohol Policy Information System (NIAAA), *Wholesale Pricing
Practices and Restrictions* **[index]**
<https://alcoholpolicy.niaaa.nih.gov/apis-policy-topics/wholesale-pricing-practices-and-restrictions/3/variables>;
CGA OLR 2000-R-0175 **[index]** <https://www.cga.ct.gov/2000/rpt/2000-R-0175.htm>

**What this settles:** a bottle price and a case price for the same item are two
separately posted, separately regulated numbers. Deriving one from the other is not a
shortcut the trade takes; in Connecticut it is a formula with a statutory additive, and
in New York the two carry different discounts. Any option in this ADR that *computes*
the missing unit is computing something the trade does not compute.

### Deposits, taxes, freight and split-case fees sit outside the unit price

- **Container deposit (CRV).** California's Beverage Container Recycling Act extended
  to wine and spirits from 2024-01-01; the distributor pays CRV and it is administered
  as a separate charge, not as part of the product price. — Wine Institute **[index]**
  <https://wineinstitute.org/our-industry/bottle-bill/>; Avalara **[index]**
  <https://www.avalara.com/blog/en/north-america/2022/11/california-bottle-fee-to-apply-to-wine-and-spirits-in-2024.html>
- **Split-case fees.** Wholesalers charge a fee for breaking a case, because breaking a
  case is real warehouse labour. — Wine-Searcher, *Cut Costs for Split Cases* **[index]**
  (direct fetch returned 403) <https://www.wine-searcher.com/m/2022/07/cut-costs-for-split-cases>
- **Freight.** LibDib publishes shipping as its own schedule by weight and distance,
  separate from the product price. — LibDib **[index]**
  <https://libdib.com/blog/winebusiness-com-libdib-unveils-new-flat-rate-shipping-program/>

**What this settles:** "$38.99 per bottle" is under-specified even once the unit is
named, because it does not say whether a deposit, a split-case fee or freight is inside
it. The invoice line already models two of these (`allowance`, `deposit`,
`baseline:4393-4394`) and the posted-price table models one (`container_charge`,
`20260904200000:103`). The agreement models none.

### Pack size is part of the item's identity, not a modifier on it

GS1's GTIN Management Standard:

> *"A change to the pre-defined number of trade items contained in a pack or case (i.e.
> trade item grouping) requires assignment of a new GTIN to the changed level and all
> impacted levels above."*
> — GS1, GTIN Management, *Pack/case quantity* **[index]** (direct fetch returned 403)
> <https://www.gs1.org/1/gtinrules/en/rule/270/packcase-quantity>

And a hierarchy is levels, each separately identified:

> *"A trade item hierarchy shows which consumer units a case contains, or which cases a
> pallet contains."* … *"Each item at the different levels is given a GTIN. Trade Item
> Information is sent for every GTIN, since they have different attributes."*
> — GS1 Sweden **[fetched]**
> <https://gs1.se/en/support/what-are-trade-item-hierarchies-and-trade-item-levels-2/>

The GDSN guideline's `TradeItemUnitDescriptor` names those levels
(`BASE_UNIT_OR_EACH`, `CASE`, `PALLET`), and a level is assigned a GTIN when it *"may be
priced, or ordered, or invoiced at any point in the supply chain."* — GS1 GDSN Trade Item
Implementation Guideline **[index]** (the page exceeds this fetcher's size limit)
<https://ref.gs1.org/guidelines/tiig/>

**What this settles:** a 6×750 case and a 12×375 case are two trade items, not one item
with two packs; and a pack change mid-agreement is a new trade item, so it should be a
new agreement line rather than an edit to the old one. This is the external warrant for
this ADR's invariant 3.

### How the reference systems model it

| System | The shape | Source |
|---|---|---|
| **xtraCHEF (Toast)** | Four fields per vendor product: **UOM** *"the purchasing UOM displayed on the invoice"*, **Pack** *"if there is more than one measurable unit within a case, this is where you'll enter the quantity"*, **Size** *"the number value of the units within each 'pack'"*, **Unit** *"the UOM of each pack"*. Their worked example: a case at $233.94 = UOM Case, Pack 6, Size 1, Unit Liter → $38.99 per bottle. | **[fetched]** <https://support.toasttab.com/en/article/xtraCHEF-Product-Verification> |
| **MarginEdge** | The invoiced unit and the counted unit are separate. When a product is invoiced by the case the system asks how many individual units are in that case; a product may carry several count-by units, and the conversion is entered **per vendor item** because different vendors pack the same product differently. | **[index]** (403 to direct fetch) <https://help.marginedge.com/hc/en-us/articles/360039865154-How-to-Change-the-Count-by-Unit-of-Measure-of-a-Product> · <https://help.marginedge.com/hc/en-us/articles/4413217353363-Adding-Multiple-Count-By-Units-for-Inventory> |
| **Restaurant365** | Three measure types (Weight, Volume, Each); a Purchased Item has a Reporting UofM; **Vendor Items** exist precisely so one purchased item can be bought in several case packs — *"If a vendor supplies the same item with different case packs or item numbers, multiple vendor items representing the different purchase UofMs / item numbers are required."* | **[fetched]** <https://docs.restaurant365.com/docs/unit-of-measure-conversions> · **[index]** <https://help.restaurant365.net/support/solutions/articles/12000039209-vendor-item-record> |
| **Odoo** | `uom_id` (stock/sales) and `uom_po_id` (purchase) are separate fields on the product; the purchase UoM must be in the same UoM *category* as the default, and the vendor pricelist line carries its own `Unit`. | **[fetched]** <https://www.odoo.com/documentation/17.0/applications/inventory_and_mrp/purchase/products/uom.html> · **[index]** <https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html> |
| **NetSuite** | A units *type* holds several units; exactly one is the **base unit** with conversion rate locked at 1; an item record names separate **Purchase / Stock / Sale** units, and *"when you choose this item on a purchase transaction, it defaults to this unit and shows the purchase price for this unit."* A unit type cannot be changed after assignment. | **[index]** <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2212143.html> · <https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2212390.html> |
| **BlueCart** | Catalogue lines carry unit sizes alongside price; the case pack is described as the standard wholesale unit of measure. Public documentation is marketing-level and does not expose a schema. | **[index]** <https://www.bluecart.com/digital-catalog-software> |
| **Choco** | Orders are transmitted with product IDs **and units**; the unit travels with the order line into the supplier's own format (email, EDI). No public schema. | **[index]** <https://choco.com/us/restaurants> · <https://www.o.choco.com/> |
| **Provi / SevenFifty** | 750k+ distributor listings; the buyer filters by **size** and by **price** as separate axes, and distributors show custom per-account pricing. Public material is marketing-level; **no published field list**, so no claim is made here about their internal price-unit model. | **[index]** <https://www.provi.com/> · <https://www.provi.com/provi-sevenfifty> · <https://go.sevenfifty.com/distributors/> |
| **LibDib** | Publishes a flat margin (15%, a 17.65% markup) and a separate shipping schedule — i.e. the money outside the unit price is a separately stated schedule, not folded in. | **[index]** <https://blog.libdib.com/what-i-have-to-say-about-pricing-which-is-a-lot-but-bear-with-me> · <https://libdib.com/blog/winebusiness-com-libdib-unveils-new-flat-rate-shipping-program/> |

**The convergent finding across all seven that publish a schema:** none of them stores a
bare price. Every one of them stores a price **paired with the unit it is quoted in**,
and every one of them keeps the *purchase* unit separate from the *stock/count* unit
rather than deriving one from the other. xtraCHEF and R365 additionally attach the pack
to the **vendor item**, not to the product — because the same product from two vendors
comes in two packs. Mudavym's `procurement_order_items` is exactly a vendor-item row
(it carries `provider` through its order, `vendor_sku`, `unit_type`, `bottles_per_unit`)
and is therefore the structurally correct home for the price's unit.

---

## Where the unit of an agreed price could live — the fork as a graph

Five surfaces bear the cost of each option. They are held fixed across the table so the
options are comparable: **[M]** migrations · **[R]** readers · **[D]** the receiving
door · **[P]** the price register · **[L]** the ledger's `uom` rule (ADR 0070/0115).

### O1 — On the agreement row (a stated price unit + price pack)

Add to `procurement_order_items`, and mirror onto `procurement_orders` only as a
derived echo: `price_uom` (the seven-word vocabulary) and `price_pack_size` (how many of
the item's canonical unit are in one of `price_uom`), so the row states its price's unit
the same way it already states its quantity's.

- **[M]** Two nullable columns + one CHECK on one table (plus the header echo). Against
  2 orders / 1 line in production and 0/0 locally, free.
- **[R]** `beverages.service.ts:readOrderLines` gains a unit label beside
  `final_unit_price`; `market-price.producer.ts` reads identity only and is unaffected;
  `confirmDeal`'s email gains the true unit word.
- **[D]** No change — the door reads `procurement_order_items.bottles_per_unit`
  (`procurement.service.ts:1270-1311`) and that column is untouched.
- **[P]** The refusal at `:4778` becomes conditional: a stated `price_uom` yields a
  sighting; a NULL one keeps the refusal and the sentence.
- **[L]** Compatible by construction — it is ADR 0070's own shape (an integer beside a
  stated unit) applied to money instead of stock, and it extends to `kg`/`L` the day
  ADR 0115 phase 2 widens the vocabulary.

### O2 — On the vendor catalogue line

Put the price and its unit on a catalogue row the agreement references.

- **[M]** `vendor_catalogue` (`baseline:6230-6247`) is a **vendor directory** — name,
  type, country, state, address, phone, website, specialties, `is_active`, plus geo and
  tier columns added by `20260807001252` and `20260807001652`. **It has no product
  column, no price column and no pack column, and there is no catalogue-*line* table
  anywhere.** O2 is therefore not "move it to where it belongs"; it is "build a new
  subsystem, then move it."
- **[R]** Every price reader would need a join that does not exist today.
- **[P]** Worse than a cost: a catalogue price is a **list** price. Under ADR 0117 it is
  class C at best, not class A. O2 answers a different question from the one asked.

### O3 — Derived from the item's `uom` + the order's pack

No new column: read `procurement_order_items.unit_type` + `bottles_per_unit` and decree
that `final_unit_price` is per bottle, dividing or multiplying as needed.

- **[M]** Zero.
- **[R]** Zero.
- **[P]** It is a **derivation**, and this codebase has already been burned by exactly
  this move at exactly this table: `resolveOrderMatchUnits` back-derives pack size from
  `bottles_total / quantity` and its own docblock records why that is dangerous — *"an
  order which booked 5 bottles for 5 cases teach[es] the door that a case holds one
  bottle"* (`procurement.service.ts:1259-1268`, guard at `:1300-1311`).
- **Killed by the outside evidence**, not merely by taste: Connecticut *defines* the
  bottle price as `case ÷ pack + 2/4/8¢`, so the derived number is provably not the
  posted one; split-case fees and NY's one-unit-per-month discount rule both break
  linearity in practice. A derivation that is wrong by 2–8¢ per bottle by statute, and
  by a split-case fee in the warehouse, is a fabricated number wearing a decimal point.

### O4 — On the invoice line only (keep the refusal, permanently)

Agreements never enter the register; only verified invoices do.

- **[M] [R] [D] [L]** Zero — this is what ships today.
- **[P]** The cost is not zero and it is not visible. A house that buys everything by
  the case gets `quote`-tier rows never, forever, and the only trace is a
  `logger.warn` in the gateway (`procurement.service.ts` `recordOwnPaperSighting`,
  `:1096-1099`). `/orders` says nothing; `/notifications`' market box says nothing;
  ADR 0117's own "order of filling" step 1 is half-built and reports as done.
  **That is the absence-reported-as-health fault, one layer up.**
- It also throws away the *quote-vs-invoice* comparison ADR 0117 built the two tiers
  for: `order_confirmed` is what a vendor agreed, `receipt_verified` is what they
  billed, and *"collapsing them would make a vendor who quotes low and bills high
  indistinguishable from one who does neither"* (`procurement.service.ts:897-900`).
  O4 does not collapse them — it deletes one of them for every case-buying house.

### O5 — Decree per bottle, and enforce the decree

Keep one number, add no column, but make the assertion real: validate at the DTO
boundary, label it "per bottle" on `/orders`, and stop the confirmation email claiming
a unit it has not checked.

- **[M]** Zero. **[R]** Small. **[P]** Lifts the refusal for every order.
- **The failure:** it makes a *true* statement about the platform and a *false* one
  about the trade. A vendor who quotes "$420 the case" has to be re-keyed as $35 by a
  human at the desk — and the moment that arithmetic is done by hand, the register holds
  a number nobody can trace to a document, which is the one property ADR 0117 exists to
  guarantee (`source_ref`, `own-paper-sighting.ts:298`). It also cannot survive ADR
  0070/0115: flour is priced per kg and a keg is priced per keg, and neither has a
  bottle to be per.
- It is, however, a **legitimate interim**: see the Decision's phase 0.

### O6 — The price is a money-per-quantity pair (the xtraCHEF quadruple)

Store `price_amount`, `price_qty`, `price_uom`, `price_pack_size` — "$233.94 per 1 case
of 6 × 1 L". Strictly more expressive than O1.

- **[M]** Four columns rather than two. **[R]** Every reader must handle
  `price_qty ≠ 1`.
- **The judgement:** `price_qty` earns its place only when a vendor quotes "3 for $100",
  which is a *quantity discount* — and in the two states whose rules were read today
  that is either regulated to one unit per month (NY) or prohibited outright (CT). The
  fourth column buys an edge case at the cost of a shape every reader must branch on.
  **Rejected as over-shaped for today; recorded because it is where O1 grows if
  tiered pricing is ever wanted.**

---

## The invariants

These bind whichever option is chosen, and each one is falsifiable against the tree.

1. **A price without a unit is not a price.** It is a numeral. The register already
   applies this to public postings (`price_unit NOT NULL`, `20260904200000:96`); the
   rule does not become optional because the number is ours.
2. **A conversion is performed once, in one place, and the operands are kept.**
   `normalizeUnitPrice` (`vendor-price-consensus.ts:115-148`) is that place; the
   sighting stores `raw_price`, `pack_size`, `unit_volume_ml` and the
   `normalization_note` beside the normalised figure (`own-paper-sighting.ts:340-345`)
   precisely so the conversion can be re-derived and disputed. A second conversion
   anywhere upstream destroys that property silently.
3. **A pack change is a new agreement line, never an edit.** GS1's rule for GTINs,
   transplanted: changing the number of units in a case creates a different trade item.
   Editing a live agreement's pack retroactively restates every sighting already
   written from it.
4. **Two numbers on one row may not assert different units without saying so.**
   `unit_type = 'case'` beside `final_unit_price` interpreted per bottle
   (`procurement.service.ts:819-821, 842-843`) is the concrete live violation.
5. **Money outside the unit price is named, not folded in.** Deposit, split-case fee,
   freight and allowance each get their own place or stay out. The invoice line already
   does this (`baseline:4393-4394`); the agreement does not.
6. **A refusal is louder than a default, and a refusal a person cannot see is not a
   refusal.** Today's case-order refusal is a gateway log line. Under any option that
   keeps a refusal, `/orders` has to show it.
7. **An unstated unit stays unstated.** No backfill invents a unit for a row that never
   had one; a NULL `price_uom` is a refusal, not an assumed bottle.

---

## Recommendation

**O1 — the agreed price states its unit on the agreement line, with the same
(unit, pack) shape the quantity already uses — plus O5 as a phase 0 that ships
independently.**

**Phase 0 (no migration).** Make the existing convention honest where it already leaves
the building. `confirmDeal`'s email says *"N bottles … at $X per bottle"* on a case
order (`:4701, :4804-4810`): it should state the order's real unit and the real bottle
count from `bottles_total`, or state neither. `/orders` should print the unit beside the
price it shows. This is worth doing whatever the founder decides on O1, because it is
wrong today and it reaches a vendor.

> **DONE — 2026-09-04 (the mail half).** The founder took phase 0 without a migration.
> `confirmDeal`'s confirmation mail now states the quantity in the order's own unit word
> and the price as `per <unit_type>`, names the pack only when `resolveOrderMatchUnits`
> actually resolved one, and where it did not, says so and asks — it never assumes one
> bottle per unit. The sentence is built by the exported `describeConfirmedOrderTerms`
> (`apps/api-gateway/src/procurement/procurement.service.ts:168-216`) and used at
> `:4998-5012`; eleven assertions in
> `apps/api-gateway/src/procurement/confirm-deal-states-its-unit.spec.ts` pin the exact
> sentence for a case order with a known pack, a case order with an unknown pack, a
> bottle order and a keg order, each also run against the pre-fix builder transcribed
> from `d870800d`.
>
> **Still open in phase 0:** the `/orders` half — printing the unit beside the price on
> the page — was out of this dispatch's scope and is not built. No schema, no migration,
> and `recordPriceHistory` still refuses a case-priced agreement exactly as before: the
> mail now says what the order holds, but the register still cannot tell a case price
> from a bottle price, which is what O1's phase 1 is for.

**Phase 1 — BUILT 2026-09-04.** The founder was asked Q1 (*ship the column before the
desk can set it?*) and answered neither half of the fork as posed: **"ship the columns
and the /orders field together"** — one bounded build, so the schema never holds a
column nobody can state and the desk never states a unit the schema cannot store. What
landed:

> * **The migration.**
>   `supabase/migrations/20260905010000_an_agreed_price_states_its_unit.sql` — two
>   nullable columns on `procurement_order_items`, three CHECKs (the seven-word
>   vocabulary; both-or-neither; a non-multiplying unit's pack is exactly 1), four column
>   comments including `procurement_orders.final_price` demoted to *an echo of the line*,
>   three in-file assertions, and **no backfill**. Measured against the local Postgres in
>   a rolled-back transaction: nine insert probes, the four legal shapes accepted
>   (case/12, bottle/1 beside a case QUANTITY, keg/1, NULL pair) and the five illegal
>   ones refused by name (uom without pack, pack without uom, `'cases'`, bottle-per-12,
>   pack 0).
> * **The writers.** `createOrder` resolves and refuses the pair before anything is
>   written and passes it to `upsertOrderLine`, which writes `price_uom` /
>   `price_pack_size` as explicit keys; the order's value is drawn from the pair
>   (`agreedOrderTotal`) instead of `finalPrice × bottlesTotal`;
>   `recordOwnPaperSighting` receives the PRICE's `(unit, pack)` rather than the
>   quantity's, so a case-priced agreement now enters the register and
>   `normalizeUnitPrice` performs the one conversion; `recordPriceHistory` converts once
>   to the per-bottle figure its `unit = 'BOTTLE'` column asserts, records the arithmetic
>   in the row's `notes`, and REFUSES a per-keg price in words rather than filing it as a
>   bottle price; `describeConfirmedOrderTerms` states the price's own unit when the row
>   has one and falls back to phase 0's sentence when it does not.
> * **The `/orders` field.** `apps/web/src/pages/orders/next/AgreementSheet.tsx` — the
>   rebuilt page's own composer, with a price-unit picker (nothing preselected), a pack
>   field shown only for a multiplying unit, the total drawn from the pair with its
>   working printed, and the register's refusal shown BEFORE the save when no unit is
>   stated. That closes phase 0's `/orders` half and invariant 6 for this surface.
> * **Proof.** 42 jest assertions in
>   `apps/api-gateway/src/procurement/agreed-price-states-its-unit.spec.ts`, each pre-fix
>   behaviour transcribed from `git show HEAD:` copies at `129fbfc6` and asserted beside
>   the post-fix one; 14 vitest assertions in
>   `apps/web/src/pages/orders/next/AgreementUnit.test.tsx`.

**Still open after phase 1**, stated so it is not discovered later:

> * ~~**Q2 is only half-answered.**~~ ~~**Q3, Q4, Q6 are untouched.**~~ **ALL FOUR
>   DECIDED AND BUILT 2026-09-05 — see "Phase 2, second half" below.** What remains of
>   this paragraph is Q7 alone: `normalizeUnitPrice` still reads a 12×375 and a 6×750 as
>   the same per-750 price.
> * ~~**The ledger row still prints a bare number.**~~ **CLOSED 2026-09-05 (phase 2).**
>   `listOrders` embeds `procurement_order_items(price_uom, price_pack_size)` in the
>   query it was already making — one statement, resolved through
>   `procurement_order_items_order_id_fkey` — and `OrderResponseDto` carries the pair as
>   `priceUom` / `pricePackSize` in **three** states: stated, JSON `null` (read, states
>   none), and the keys ABSENT (this route does not read the line). Two defects were
>   found in the building: the row was reading `unitPrice` / `totalPrice`, names the list
>   route has never sent, so every live row printed an em dash where the money goes; and
>   the first build of the fix totalled an unstated price per bottle and printed
>   `60 × $420.00 = $25,200.00` beside the ledger's own $2,100.00 — this ADR's own error,
>   reprinted by the screen built to end it. An unstated unit now yields no working at
>   all. `06-pages/orders.md` §13.10, `LedgerUnit.test.tsx`.
> * **The legacy `/orders`** (`apps/web/src/pages/Orders.tsx`, what production shows with
>   `mudavym_design_orders` off) is deliberately unchanged and cannot state a price unit.

**Phase 2, second half — BUILT 2026-09-05.** The founder decided Q2, Q3, Q4 and Q6
together. What landed, and what each decision cost:

> **Q2 — the header price is an echo the DATABASE enforces, not a comment.**
> "Generated from the line" is the right semantics and an impossible mechanism, and the
> impossibility was MEASURED rather than assumed (Postgres 18.3 via PGlite 0.5.8,
> `$SP/pglite-probe/q2-probe.mjs`, over a transcription of the two tables):
> a generation expression may not contain a subquery (`0A000`); the one spelling Postgres
> ACCEPTS — the subquery wrapped in a function labelled `IMMUTABLE` — is the worst
> outcome available, because the label is taken on trust and the expression is evaluated
> once at insert, when the order has no line yet, and never recomputed; and `final_price`
> cannot become generated in place under any syntax (`42601` for
> `ADD GENERATED … AS`, `55000` for `SET EXPRESSION` on a non-generated column). On top
> of that the column is `NOT NULL` on a row inserted BEFORE its line exists, so a CHECK
> refusing every direct write would make an order uncreatable.
> `20260905072000_the_header_price_echoes_the_line.sql` therefore ships a trigger pair:
> the line writes the header, and a direct write to `final_price` that disagrees with the
> line is refused with `23514` naming the two numbers. `confirmDeal` and
> `InboundResponder.syncOrderState` now write the LINE; both fall back to the header only
> when the order has no line, which the trigger permits and which they say out loud.
> Measured against production (`Restaurant_Wine_Ops`, PG 17.6.1.063, read-only,
> 2026-09-05): 2 orders, 1 line, **0 orders whose line disagrees with their header**, so
> the migration's pre-flight assertion costs nothing. Nothing is reconciled — a header
> that disagreed would be a fact about that order, and the migration raises instead of
> picking a winner.
>
> **Q4 — `price_history` carries a stated unit, and refuses a price that has none.**
> `20260905072500_the_price_series_states_its_unit.sql`: `unit` becomes `NOT NULL`, its
> `DEFAULT 'BOTTLE'` is DROPPED, and a CHECK admits the same seven singulars as every
> other unit column (the fifth copy of one vocabulary). Nothing is converted on the way
> in any more — a case price enters AS a case price, a keg price enters at all for the
> first time, and `perBottleFromAgreedPrice` is no longer this path's arithmetic. **The
> reversal that matters:** an agreement stating NO unit used to enter the series anyway,
> as `'BOTTLE'`, on no evidence; it is now refused in a sentence, which is the same
> refusal `decideOwnPaperSighting` already made about the same event. Production held 0
> `price_history` rows and 0 NULL units (measured 2026-09-05), so the only data change is
> a case-fold of `'BOTTLE'` → `'bottle'` — provable rather than assumed, because the one
> writer that produced that spelling converted to per-bottle before inserting. Anything
> else raises.
> **The cost, conceded rather than argued away:** this ADR itself rejected a widened
> `unit` on the grounds that *"a per-bottle series whose unit could vary is a series
> nothing can average."* That is true. The obligation moves from the writer to the
> reader — every comparison must GROUP BY unit first — and the column comment says so
> where a reader will find it. Measured on this tree there is no such reader yet: the
> insert in `recordPriceHistory` is the only statement in `apps/` or `services/` that
> touches the table.
>
> **Q3 — the money outside the price has three columns and the total prints its
> working.** `20260905073000_the_agreement_names_the_money_outside_the_price.sql` adds
> `allowance`, `deposit`, `freight` (`numeric(12,2)`, nullable, each `>= 0`) to
> `procurement_order_items`, mirroring the invoice line's own `allowance`/`deposit`.
> All three are POSITIVE amounts for the whole line; the direction is in the name, never
> in a sign. `agreementLineTotal` computes goods − allowance + deposit + freight and
> returns the arithmetic as a sentence; `AgreementSheet` gains the three fields and the
> ledger row prints them. **NULL and 0 stay different facts** end to end: an empty field
> sends no key, so the column keeps NULL, and a typed 0 travels — "no deposit was agreed"
> and "a deposit of zero was agreed" are different claims about a vendor.
> **The receiving door compares like with like.** Measured first: `verifyReceipt` fed
> `procurement_orders.final_price` — the unit-less header — straight into
> `computeMatch`'s `poUnitPrice`, which `invoice-match.ts` documents as PER BOTTLE and
> compares directly against the invoice's per-bottle price. A case-priced agreement
> therefore produced `price_variance`, the loudest verdict the module reaches, on an
> order where nothing was wrong. The door now reads the LINE and converts once from its
> stated pair; an OPAQUE pair (keg, litre) makes NO price comparison at all rather than a
> wrong one; and the agreement's fees are named in the verdict's own notes so an invoice
> that bills a deposit the agreement provided for does not read as a price variance.
> Also measured, and NOT closed: the invoice line's `allowance`/`deposit` columns are
> written by the parser and read by nothing at the door — only a caller-supplied
> `allocatedCharges` scalar reaches `computeMatch`. That is the other half of "like with
> like" and it is named in `06-pages/receiving.md` §13 rather than assumed done.
>
> **Q6 — `split_case` stops being a bare vocabulary word.** It now means one thing: *this
> line is the broken case, as its own trade item, with its own price*, and
> `price_pack_size` is the number of bottles actually in the broken pack. It is never a
> fee added to a case line — which is why this build adds no `split_case_fee` column and
> the sheet has no such field. `procurement_order_items_split_case_own_line_check`
> refuses the one shape a single row can be judged on: `case` on one axis and
> `split_case` on the other, in either direction. `createOrder` says the same thing in a
> sentence before the `23514`. What a CHECK cannot see is a split-case fee hidden inside
> `freight` on a case line; nothing in a row can. What it can do is leave that fee no home
> of its own.
>
> **Proof.** All three migrations applied and exercised against a real Postgres
> (`$SP/pglite-probe/apply-and-probe.mjs`, PG 18.3): the case-fold, the NOT NULL, the
> vocabulary CHECK refusing `'BOTTLE'` and `'cases'`; the header following the line on
> insert, update, delete-then-reinsert; the direct header write refused with the ADR's own
> sentence and the same write ACCEPTED when it agrees with the line or when no line
> exists; the fee sign rule; and all four split-case pairings. 20 assertions in
> `apps/api-gateway/src/procurement/price-unit-phase2.spec.ts` (each pre-fix behaviour
> transcribed from `git show HEAD:` copies at `611f7682` under
> `$SP/prefix-phase2/`), 4 more in `order-capture.spec.ts` driving the service, and 11
> vitest cases in `apps/web/src/pages/orders/next/AgreementFees.test.tsx`. Captures on
> both grounds in `$SP/shots-price-unit-2/`, which found two defects of their own — the
> row printed the total twice, and printed the fees twice — both fixed before the shots
> that ship.

The sketch the migration was written from, kept for the record — no file, no timestamp
claimed, gated per ADR 0070's rule that no migration lands before the schema-parity fix:

```
-- SKETCH ONLY. Not a migration. Not written to supabase/migrations/.
-- procurement_order_items: the price states its own unit, exactly as the
-- quantity already does one column over.
--   price_uom        varchar(20)  NULL  -- same seven-word vocabulary as unit_type;
--                                       -- NULL = unstated = a refusal, never a bottle
--   price_pack_size  integer      NULL  CHECK (price_pack_size IS NULL OR >= 1)
--   CHECK (price_uom IS NULL OR price_uom = ANY (the seven))
--   CHECK ((price_uom IS NULL) = (price_pack_size IS NULL))   -- both or neither
--   CHECK (price_uom IS NULL
--          OR price_uom IN ('case','pack','split_case')       -- multiplying: pack > 1 allowed
--          OR price_pack_size = 1)                            -- non-multiplying: exactly one
-- Comment on both columns: the price's unit is INDEPENDENT of the quantity's
-- unit. An order of 5 cases priced per bottle is a real, ordinary order, and
-- the two columns disagreeing is the trade fact, not a contradiction.
--
-- procurement_orders: NO new price-unit column. The header's final_price is
-- documented as an echo of the line and stops being a second source of truth.
-- (If the founder wants it stated on the header too, it must be GENERATED from
-- the line or it becomes the next place the two readings diverge.)
--
-- No backfill. Existing rows keep price_uom NULL and keep refusing.
```

**Why the (unit, pack) pair and not a two-value "per bottle / per ordered unit" flag.**
A flag cannot say *per litre* or *per kg*, so it dies the day ADR 0115 phase 2 widens the
intake vocabulary — which is the same dispatch the founder has already funded. The pair
survives that widening for free, because it draws from the same vocabulary the door will
be taught.

**What it costs to be wrong.** If O1 ships and nobody ever states a `price_uom`, every
row stays NULL and the register keeps refusing exactly as it does today — the failure
mode is the status quo, not a wrong number. That asymmetry is why O1 is recommended over
O5, whose failure mode is a per-bottle claim on a case-priced row that no later reader
can detect.

### The strongest counter-argument

**"You are putting a second unit on a row that already has one, and two unit columns on
one row is the exact fault you are trying to end."**

This is the serious objection and it deserves the space. The row would carry
`unit_type`/`bottles_per_unit` for the quantity and `price_uom`/`price_pack_size` for
the price, and a writer could set them inconsistently. That is a genuinely new way for
the row to be wrong, and it is the same *shape* as `price_history.unit = 'BOTTLE'` sitting
beside `procurement_orders.unit_type = 'case'` — which is the wound that produced ADR
0117's Q6 in the first place. Adding a column to fix a two-columns-disagree problem is
not obviously progress.

**The answer, and its limit.** The two units differing is not an inconsistency — it is
the trade fact. Connecticut requires a case price *and* a bottle price to be posted for
the same item; New York lets a discount attach to one unit and not the other; a house
routinely orders five cases at a per-bottle price. A schema that forbids the two from
differing is not safer, it is *unable to record ordinary orders* — which is precisely
why the register refuses them today. The difference between the two columns and the
`price_history` wound is that the wound was **two tables asserting different units about
one number with no way to compare them**, whereas this is **one row stating both units
explicitly, adjacent, with a CHECK relating them.** Contradiction becomes visible
instead of implicit.

**But the limit is real and must be conceded:** a CHECK can enforce that `price_uom` is
in the vocabulary and that a non-multiplying unit has pack 1. It **cannot** enforce that
the number in `final_unit_price` is actually in `price_uom` — only the person or parser
who typed it knows that. So O1 does not make a mis-keyed price impossible; it makes a
mis-keyed price *auditable*, and it moves the failure from silent to attributable. If
the founder judges that insufficient, the honest alternative is O4 (stay out of the
register) — **not** O3 or O5, both of which produce a confident number from an unchecked
assumption.

---

## Rejected, and why in one line each

- **O2 (vendor catalogue line)** — there is no catalogue line table; `vendor_catalogue`
  is a vendor directory with no price or pack column (`baseline:6230-6247`), and a
  catalogue price is class C, not the house's own paper.
- **O3 (derive from item uom + pack)** — the derivation is provably not the trade's
  number (CT's `case ÷ pack + 2/4/8¢`), and back-derivation at this exact table is the
  documented cause of the door's pack-size defect (`procurement.service.ts:1259-1268`).
- **O5 as the permanent answer** — makes a claim the schema cannot check, forces a human
  to do the conversion off-document, and cannot express a per-kg or per-keg price.
- **O6 (four-column money-per-quantity)** — buys tiered pricing that CT prohibits and NY
  restricts, at the cost of a branch in every reader.
- **Widening `price_history.unit`** — a per-bottle series whose unit could vary is a
  series nothing can average; the column's own comment already argues this
  (`procurement.service.ts:959-976`). If the series is to hold other units it needs a
  decision about what the series *means*, not a widened column. Deliberately left as a
  founder question (Q4) rather than decided here.

---

## Consequences if O1 is taken

**Easier.** A case-priced agreement becomes recordable, and the `quote` tier stops being
empty for case-buying houses. The register's class-A rows carry the same five-part
provenance the class-B/D/E rows already carry (`20260904200000`), so the two registers
stop disagreeing about what a price is. `/orders` can print a price with its unit
instead of a bare number. The path to food prices (per kg, per L) is the same column,
widened once with the door.

**Harder, or given up.** Two more columns for every writer to set, and a page control to
set them, or they stay NULL and nothing changes. `procurement_orders.final_price` has to
be demoted to an echo, which is a small semantic migration for every reader that treats
it as authoritative (`:1994, :2312, :3516, :4737`). The refusal does not disappear — it
narrows to rows whose unit is genuinely unstated, and it still has to be shown on the
page rather than logged.

**What this does NOT fix, stated so it is not discovered later.** Lifting the refusal
does not light the market box: `MARKET_WINDOW_DAYS = 30` and
`MIN_BASELINE_OBSERVATIONS = 3` with `minObservations` counting *earlier* sightings
means a product needs four sightings in thirty days (ADR 0117 §Context 5). A house
placing one order a month per wine still sees nothing. This ADR is about never filing a
case price as a bottle price; it is not a plan to make the box speak.

**Revisit if.** A vendor quotes tiered pricing that `price_qty` would be needed for
(→ O6); or ADR 0115 phase 2 widens the intake vocabulary and the price vocabulary is
found to need a *different* list from the quantity vocabulary; or the header
`final_price` turns out to be written by a path the line is not.

---

## Founder-only questions

1. ~~**Ship the column before the desk can set it?**~~ **ANSWERED 2026-09-04: neither —
   "ship the columns and the /orders field together."** Built; see phase 1 above.
2. ~~**Is `procurement_orders.final_price` demoted to an echo of the line?**~~
   **ANSWERED 2026-09-05: yes — "a generated column from the line's pair; no writer can
   make the two disagree; the four readers keep working."** Built as a trigger pair,
   because Postgres cannot express it as GENERATED and the column is NOT NULL on a row
   that exists before its line; the impossibility was measured rather than assumed. See
   "Phase 2, second half" above.
3. ~~**Where does the money outside the unit price go?**~~ **ANSWERED 2026-09-05:
   allowance, deposit and freight get their own columns on the agreement line, mirroring
   the invoice; the total prints its working; the receiving door compares like with
   like.** Built. Note the split-case FEE is deliberately not among them — Q6 makes a
   split case its own line rather than a surcharge, so the fee has no column to hide
   in.
4. ~~**Does `price_history.unit` stay hardcoded `'BOTTLE'`?**~~ **ANSWERED 2026-09-05:
   option B — "it carries a stated unit; kegs and cases enter with their own unit; every
   comparison groups by unit first."** Built: NOT NULL, no default, the seven-word CHECK,
   no conversion on the way in, and an agreement that states no unit is refused from the
   series rather than filed as a bottle. The expense the option was named for is real and
   is now the reader's: see the conceded cost above.
5. ~~**Fix the confirmation email now?**~~ **ANSWERED: yes.** The mail half shipped in
   `f7ae750e` (phase 0) and phase 1 taught the same sentence to state the price's own
   unit when the line carries one.
6. ~~**Is a split case a different agreement line from a case?**~~ **ANSWERED
   2026-09-05: its own line — "a different pack with a different price, never a surcharge
   on the case line."** Built as a row-level CHECK plus a sentence before it, and as the
   absence of any split-case fee column anywhere.
7. **A 12×375 case and a 6×750 case normalise to the same per-750 price today**
   (`vendor-price-consensus.ts:129-141`). Volumetrically right, commercially wrong.
   Leave it, or should format be part of the comparison key rather than a scale factor?

---

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (build, the read-side guard) | Founder decided Q4 as stated (*`price_history` carries a stated unit; every comparison groups by unit first*) and asked for the guard NOW rather than at the first reader. The write half is enforced by `20260905072500_the_price_series_states_its_unit.sql` (NOT NULL, vocabulary CHECK, default dropped); no constraint can enforce the read half, and phase 2's own trail row conceded the rule was recorded only in a column comment. `scripts/check_price_history_reads_group_by_unit.py` closes that: every `.from("price_history")`/`.table("price_history")` chain that selects, and every raw `select ... from price_history`, must filter on `unit`, `GROUP BY unit`, or aggregate keyed by `unit` in the code that follows; writes are ignored. It refuses with exit 2 — never 0, never 1 — on an aggregation whose grouping key the parse cannot follow, and on a vanished read root, a missing comment stripper, or the literal `price_history` disappearing from the roots (never-vacuous). The cost of landing it today is measured at zero: `grep -rn "price_history" apps services` over `*.ts,*.tsx,*.py,*.sql` minus `/dist/` shows ONE writer and ZERO readers — the orchestrator's `_get_price_history` reads `procurement_orders.price_per_bottle`, a different table sharing the phrase. Proved in both directions rather than argued: PASS on the tree (`0 readers today`, 37 mentions across 2027 source files in 4 roots) and FAIL naming `planted-price-read.ts:4` on an rsync'd copy of the tree carrying a planted `.select("price, observed_at").eq("inventory_id", …)` — nothing was ever planted into the worktree. 10-branch `--self-test` PASS; 16 pytest cases in `scripts/test_price_history_reads_group_by_unit.py`. Wired into `ci.yml` in `schema-code-parity` beside `check_read_columns_exist` (guard + `--self-test`, the shape that job already uses) and into the `scripts-tests` pytest list. |
| 2026-09-05 | Claude (build, the shared type + a guard) | Founder: *"fix the shared type and audit every consumer now."* The two never-sent keys this ADR filed were measured to be NINE (`unitPrice`, `totalPrice`, `wineId`, `providerName`, `wineProducer`, `notes`, `createdAt`, `updatedAt`, `recurrence`), and the DTO was sending FOURTEEN the shared type never named — which is why three files carried widening casts to reach fields the server had sent all along. Twenty-three consumer files audited in sixteen rows, each pre-fix output MEASURED by running its own expression against the object `mapOrderRow` emits (`$SP/p4an-prefix-reads.mjs`): `"$0"` on the dashboard's hold-to-approve seal, `"$NaN"` on the provider card, a `· ordered $X` clause silently vanishing from every receipt although the route carried the figure, `cost: 0` WRITTEN onto an inventory-update event, and `useOrdersMetrics` defaulting both money keys to zero so every procurement-spend figure on /reports and the dashboard was a sum of zeroes. Three more absences found and named rather than faked: the route sends no vendor name (so the receiving door's credit-note letter has never named the vendor it is addressed to), no `recurrence` (so the rebuilt page's Recurring station has always been empty), and no `quantityReceived` (so mobile receiving pre-fills from the ORDERED quantity). A value-level lie the new guard cannot see was fixed too: `status` was typed as the lowercase UI vocabulary while the wire sends SCREAMING_SNAKE, which made `OneTapActionCenter`'s delivery-card filter false for every order ever fetched. `scripts/check_web_reads_gateway_dto_keys.py` proven FAIL against a temp copy carrying a phantom `unitPrice` and PASS on the fixed tree, with a 16-case self-test; `eslint` unrun (`eslint-plugin-jsx-a11y` is not installed at any level of this checkout). |
| 2026-09-05 | Claude (build, phase 2 second half) | Founder decided Q2, Q3, Q4 and Q6 in one message. Q2's mechanism was MEASURED before it was designed: a throwaway Postgres (PGlite 0.5.8 / PG 18.3) proved a generation expression cannot read another table (`0A000`), that the one spelling Postgres accepts — an `IMMUTABLE` function wrapping the subquery — is a column that silently never recomputes, and that `final_price` cannot become generated in place at all (`42601`, `55000`); with `NOT NULL` on a header inserted before its line, a trigger pair is what is left, and the migration records the whole probe so nobody "fixes" it back. Production was read (read-only, `Restaurant_Wine_Ops`): 2 orders, 1 line, 0 header/line disagreements, 0 `price_history` rows — so every migration's assertions cost nothing and no backfill invents anything. Three migrations applied end to end against a real Postgres with 21 accept/refuse probes. Two defects found by CAPTURING rather than by reading: the ledger row printed the total twice (the working sentence carried a figure its caller also prints) and printed the fees twice (a dedicated line under a working that already named them); both fixed, both now guarded. Q4's cost — a series whose unit can vary is a series nothing can average — is conceded in the ADR rather than argued away, and measured: `price_history` has one writer and NO reader anywhere in `apps/` or `services/`, so the grouping rule is recorded in the column comment for the first reader. What was NOT closed and is named rather than assumed: the invoice line's own `allowance`/`deposit` columns still reach no comparison at the door. `check_order_capture_contract.py` needed no teaching — it asserts that a writer EXISTS and that no fallback multiplies, not which columns a payload carries — and both new regressions it might have covered are refused by the database instead (the `unit` CHECK rejects `'BOTTLE'`; the echo trigger rejects a direct header write). 24 jest + 11 vitest new assertions; gateway `tsc` clean on both projects; `eslint` unrun (the repo's shared config needs `eslint-plugin-jsx-a11y`, which is not installed at any level of this checkout). |
| 2026-09-05 | Claude (build, phase 2) | Founder: *"teach the list route the pair and show it on the rows; leave legacy as is."* `listOrders` embeds the line in the query it already made (one statement, not N+1); `mapOrderRow` gained an `AgreedPriceUnitReading` argument defaulting to `{ read: false }` so a route that does not read the line emits NEITHER key rather than a null that would read as "unstated". Two defects found by measuring rather than by reading: `toRow` read key names the route has never sent (pre-fix proof by `git show HEAD:` into same-depth probe files, `$SP/p4ag-prefix-proof.txt` — the row printed an em dash, NOT the bare price the dispatch assumed), and the first build reprinted this ADR's own twelve-times error for an unstated pair, caught in the first capture and now guarded by a test. Also measured: `scripts/check_read_columns_exist.py` is BLIND to columns inside a PostgREST embed — a phantom `price_pack_size_PHANTOM` inside `procurement_order_items(...)` passes, while a phantom top-level column on the same select FAILS at line 1690. 9 new vitest cases, 8 new jest cases; gateway `tsc` clean; `check_gateway_boots.sh` fails on two OTHER builders' uncommitted work. |
| 2026-09-04 | Claude (build, phase 1) | Founder chose *"ship the columns and the /orders field together"* over both halves of Q1's fork. Built the migration, the four writers and the `/orders` price-unit control in one pass; 42 jest + 14 vitest assertions, each pre-fix behaviour transcribed from `git show HEAD:` copies at `129fbfc6` rather than reverted (the shared worktree's stash rule). The migration was measured against a local Postgres inside a rolled-back transaction: 4 legal shapes accepted, 5 illegal ones refused by constraint name. Q2 answered only as a comment, not as a GENERATED column, and said so. Status moved off "research only", which the ADR's own first line had made untrue. |
| 2026-09-04 | Claude (research) | Created in answer to ADR 0117 Q6 on the founder's *"research. cover every angle."* Six options mapped across five cost surfaces; the leading candidate (O1) attacked with the two-units-on-one-row objection and the objection's residue conceded rather than argued away; O3 killed on external regulatory evidence (CT's statutory bottle-price formula) rather than on taste. Nine external sources cited with URLs, fetch status marked per source. No code, no migration, no OPEN-DECISIONS edit. ADR number `0119` from `check_adr_numbers_unique.py next_free()` over 628 refs **plus** a `git worktree list` sweep of 51 worktrees, both re-run immediately before writing. |
