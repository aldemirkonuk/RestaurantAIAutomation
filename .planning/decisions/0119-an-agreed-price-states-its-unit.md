# 0119 — An agreed price states its unit

- **Status:** Proposed — research only. No code, no migration, no schema change. This
  ADR answers ADR 0117's Q6 (*"a case-priced agreement has no unit to state its price
  in"*) with a mapped fork and a recommendation; the call is the founder's.
- **Date:** 2026-09-04
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

**Phase 1 (the migration this ADR does NOT write).** Sketch only — no file, no
timestamp claimed, gated per ADR 0070's rule that no migration lands before the
schema-parity fix:

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

1. **Ship the column before the desk can set it?** O1's columns are free to add against
   0–2 rows and stay NULL until `/orders` grows a unit control. Add them now and let the
   refusal narrow gradually, or hold the whole thing until the page can state a unit —
   accepting that the register keeps refusing every case order meanwhile?
2. **Is `procurement_orders.final_price` demoted to an echo of the line?** Today it is
   independently writable (`:4715-4716`) and independently read. Making it derived
   removes a divergence permanently; keeping it writable keeps a second number that can
   disagree with the line.
3. **Where does the money outside the unit price go?** Deposit, split-case fee and
   freight are real and the invoice line already has `allowance` and `deposit`
   (`baseline:4393-4394`). Name them on the agreement too, or rule that an agreement
   states only the goods price and every other charge is discovered at the invoice?
4. **Does `price_history.unit` stay hardcoded `'BOTTLE'`?** Option A: it stays a strictly
   per-bottle series and a case price is converted once on the way in, with the
   conversion recorded. Option B: it carries the stated unit and every reader must group
   by it. B is more truthful and more expensive; A is the current shape and is a lie the
   moment a keg is priced.
5. **Fix the confirmation email now?** *"5 bottles … at $X per bottle"* on an order of 5
   cases (`:4701, :4804-4810`) is wrong today and reaches a vendor. This is phase 0 and
   needs no migration — do it in the next dispatch, or hold it with the rest?
6. **Is a split case a different agreement line from a case?** GS1 says a pack change is
   a new trade item. Treat `split_case` as its own line with its own price and its own
   fee, or as a case line carrying a surcharge?
7. **A 12×375 case and a 6×750 case normalise to the same per-750 price today**
   (`vendor-price-consensus.ts:129-141`). Volumetrically right, commercially wrong.
   Leave it, or should format be part of the comparison key rather than a scale factor?

---

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | Claude (research) | Created in answer to ADR 0117 Q6 on the founder's *"research. cover every angle."* Six options mapped across five cost surfaces; the leading candidate (O1) attacked with the two-units-on-one-row objection and the objection's residue conceded rather than argued away; O3 killed on external regulatory evidence (CT's statutory bottle-price formula) rather than on taste. Nine external sources cited with URLs, fetch status marked per source. No code, no migration, no OPEN-DECISIONS edit. ADR number `0119` from `check_adr_numbers_unique.py next_free()` over 628 refs **plus** a `git worktree list` sweep of 51 worktrees, both re-run immediately before writing. |
