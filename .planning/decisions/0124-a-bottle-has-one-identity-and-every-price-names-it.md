# 0124 — A bottle has one identity, and every price names it

- **Status:** Proposed — **BUILT on `feat/mudavym-design-p4`, 2026-09-05, and the
  migration is NOT applied anywhere.** The register, the keys table, the candidate
  queue, the nullable `identity_id` on three price/stock registers, the exact-key
  joiner, the candidate generator, the confirm/reject/undo routes with their
  decision log (Q2, answered by the founder 2026-09-05 and built the same day) and
  the reader change all exist; **not one identity row is written by anything that runs on its
  own.** Every number below was measured by this session on the tree it reports.
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** identity, LWIN, GTIN, UPC, EAN, SCC, GS1, TTB COLA, entity resolution,
  blocking, candidate queue, beverage_identities, source keys, comparison key, format,
  pack, ADR 0119 Q7, ADR 0117 Q28
- **Links:** `[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]` (Q28, the
  question this answers), `[[0115-the-house-item-is-the-ledgers-key]]` (the house item;
  this is the trade item beside it), `[[0119-an-agreed-price-states-its-unit]]` (Q7,
  answered here by construction), `[[0070-a-quantity-states-its-own-unit]]` (which parked
  the beverage identity axis), `[[0111-the-calendar-is-the-houses-day-book]]`,
  `[[0016-ledgers-must-express-unknown]]`, `[[0020-no-fabricated-answers]]`,
  `supabase/migrations/20260905140000_a_bottle_has_one_identity.sql`,
  `apps/api-gateway/src/vendor-intel/beverage-identity.ts`,
  `apps/api-gateway/src/vendor-intel/identity-join.ts`,
  `apps/api-gateway/src/vendor-intel/identity.service.ts`,
  `scripts/backfill_identity_source_keys.py`

## The question, and the founder's answer

ADR 0117 §"The sweep that reads merchant shops" left **Q28: which pages should the
sweep read?** Its own three options were a per-house watch list, a shop's best-sellers,
or *"the identity join to `master_wine_library` … the largest and the only one that
makes an index line answer **what does this bottle cost elsewhere**."* Asked, the
founder said, verbatim:

> **"Do the SOTA and best for scalability thinking there might be more in future"**

So this ADR is the identity join, and "more in future" is the constraint that shaped
every part of it: **a new source adds a row, never a column.**

## What the standards actually say (every URL fetched 2026-09-05)

| Standard | What it identifies | What it says, verbatim | Source |
|---|---|---|---|
| **GS1 GTIN Management Standard 1.1**, Ratified Sep 2023 | A trade item at one packaging level | §2.3 *"Any change (increase or decrease) to the legally-required declared net content that is printed on the pack, requires assignment of a new GTIN."* §2.8 *"A change to the number of trade items in a case or a change to the quantity of cases in a predefined pallet configuration, requires assignment of a new GTIN."* | **[fetched, 381,277 B, sha256 `8f8a2524…`]** <https://ref.gs1.org/standards/gtin-management/> (`www.gs1.org` 403s this fetcher, twice) |
| **GS1 trade item hierarchy** | Each level separately | *"Each item at the different levels is given a GTIN. Trade Item Information is sent for every GTIN, since they have different attributes."* | **[fetched]** <https://gs1.se/en/support/what-are-trade-item-hierarchies-and-trade-item-levels-2/> |
| **LWIN** (Liv-ex) | A wine, then vintage, pack and bottle size | The live page states the licence and the size — *"over 200,000 wines and spirits"*, *"free to download, and always will be under the Creative Commons licence"* — and **does not publish the digit structure**. | **[fetched, 147,184 B]** <https://www.liv-ex.com/lwin/> |
| **LWIN licence** | — | **CC BY 4.0.** *"Share — copy and redistribute the material in any medium or format"*; *"Adapt — remix, transform, and build upon the material for any purpose, even commercially"*; *"You must give appropriate credit, provide a link to the license, and indicate if changes were made."* | **[fetched]** <https://www.liv-ex.com/lwin/lwin-creative-commons/> |
| **LWIN structure** | LWIN-7 wine (6 + check digit) · -11 +vintage · -16 +bottle size · -18 +pack | *"LWIN (7 digits): base wine identifier … LWIN-16: adds vintage, pack, and bottle size"*; sizes are millilitres zero-padded to five. | **[fetched — SECONDARY, and flagged as such]** <https://en.wikipedia.org/wiki/Liv-ex> · the `liv-ex.com/2014/10/lwin-common-language-fine-wine/` post that carried it now **404s**, and `/lwin-3/…` **301s** to the page that omits it |
| **TTB COLA** | A **label**, not a package | *"a database that provides access to information on Certification/Exemption of Label/Bottle Approvals"*; no registration required; images *"from 1999 to present"*, available *"48 hours after they have been approved"*. | **[fetched]** <https://www.ttb.gov/regulated-commodities/labeling/cola-public-registry> — the registry host itself (`ttbonline.gov`) **reset the connection** to this fetcher, recorded unverified |
| **EU lot marking, Directive 2011/91/EU** | A **production batch**, never a product | A lot is *"a batch of sales units of a foodstuff produced, manufactured or packaged under practically the same conditions"*, determined *"by the producer, manufacturer or packager"*, marked with a leading `L`. | **[fetched]** <https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32011L0091> |
| **CellarTracker** (4.1 m wines) — the practitioner's verdict | — | *"Many wines do not have UPC/EAN codes"*; *"The same wine can have many barcodes"* (per importer, per size, per NV release); *"In some cases, the same UPC/EAN can be used for many wines … vintage variations are often glossed over"*; **"UPC/EAN is not living up to its full potential when it comes to wine."** 858,686 codes cover 2,074,378 of 4.1 m wines — *"just over 50%"*. Their answer since 2014: **multiple codes per wine**, attached by a person at scan time. | **[fetched, 19,967 B]** <https://support.cellartracker.com/article/10-about-upc-and-ean-barcodes> |
| **Vivino** — the fallback everyone uses | — | *"you can submit the label for manual identification. Our team reviews these submissions and typically has a match added within a few hours"*; *"Older vintages sometimes have separate entries."* | **[fetched]** <https://www.vivino.com/en/wine-news/how-the-vivino-label-scanner-works> |
| **AWS Entity Resolution** — the commodity shape | — | *"You can also better track products that use different codes (for example, SKU, UPC) across your stores."* Rule-based matches carry *"the rule number used to generate that match … to help you understand the match"*; ML matches carry a *"confidence score of 0.0–1.0"*. | **[fetched]** <https://docs.aws.amazon.com/entityresolution/latest/userguide/what-is-service.html> |
| **SC-Block** (arXiv 2303.03132) | Blocking | A pipeline is *"a blocker that applies a computationally cheap method to select candidate record pairs"* then an expensive matcher; SC-Block pipelines run *"1.5 to 2 times faster … without sacrificing F1 score"* at 99.5% pair completeness. | **[fetched]** <https://arxiv.org/abs/2303.03132> |
| **Ditto** (arXiv 2004.00584) | Matching | Transformer matching beats prior SOTA *"by up to 29% of F1 score"*, +9.8% with its three optimisations. | **[fetched]** <https://arxiv.org/abs/2004.00584> |
| **WDC Products** (arXiv 2301.09521) | The benchmark that matters here | Varies *"(i) amount of corner-cases (ii) generalization to unseen entities, and (iii) development set size"*; gold standard built from **GTIN/MPN clusters**; finding: *"all matching systems struggle with unseen entities to varying degrees."* | **[fetched]** <https://arxiv.org/abs/2301.09521> |

**Wine-Searcher's trade API** returned **403** to this fetcher at
<https://www.wine-searcher.com/trade/api> (as its news article did), so nothing is
claimed about how it matches. ADR 0117 Q5 already has the founder requesting a quote.

**The convergent finding.** GS1 and LWIN, from opposite directions, both say a bottle's
identity is **wine + vintage + size + pack**. CellarTracker and Vivino, the two largest
wine databases in the world, both say a code is not enough and both put **a person** at
the end. Nobody who has done this at scale auto-merges.

## What the repo actually has — measured, read-only, 2026-09-05

Production project `exzueerziesmczwlhomd`, read through the Supabase connector; the
gateway process on `127.0.0.1:4000` answered **404 to every route including `/auth/me`**
and `/price-index/status`, so no route was curled (see §Verification).

### Exact keys: the estate has none

| Table | Rows | `upc` | `ean` | `barcode` | `sku` | other |
|---|---|---|---|---|---|---|
| `master_wine_library` | 4,226 (3,562 live) | **0** | **0** | **0** | 1 | `manufacturer_sku` 0, `distributor_skus` 0, `barcode_vintage_mapping` 0 |
| `beverages` | 608 | **0** | **0** | **0** | **0** | `identity_key` 608 (a residual-token key, no size, no pack) |
| `restaurant_inventory` | 206 | — | — | — | 1 | **no barcode/upc column exists at all**; `internal_sku` 0, `pos_sku` 0, `sku_aliases` 0 |
| `procurement_order_items` | 1 | **0** | — | — | 0 | `vendor_sku` 0 |
| `vendor_price_observations` | **0 rows** | | | | | `price_history` **0 rows** |

So the honest answer to *"how many sightings could be joined by exact key vs by name"*
is **neither: there are no sightings.** The join is being built for an empty register,
on purpose, because the alternative is building it after the register fills and then
re-deriving every stored comparison.

### The library does not know a single bottle's size

`master_wine_library.bottle_size_ml` is **750 on all 4,226 rows — one distinct value**,
which is the column DEFAULT. Only **2 of 3,562** live rows name a format anywhere in
`name`. `restaurant_inventory.bottle_size_ml` is known on **51 of 206** (47 × 750,
4 × 375) and NULL on 155.

This is the single fact that decided the shape. A register keyed on the library cannot
hold size, and a library row cannot hold two sizes.

### Iowa: 100% coverage, and 1,736 collisions

The live file, fetched today —
`https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json`, HTTP 200, **5,425,785 bytes**
(a zip), 13,762 rows, `report_as_of` **2026-09-01 on every one**:

| Measurement | Value |
|---|---|
| `upc` present | **13,762 / 13,762 (100%)**, every one 12 digits |
| `upc` passing its GS1 check digit | **13,762 / 13,762** |
| distinct `upc` values | **9,118** |
| UPCs naming **more than one** distinct `item_no` | **1,736** (4,069 items) |
| … where the items differ in `bottle_volume_ml` | **343** |
| … where the items differ in name | **1,344** |
| worst single UPC | **12 rows** |
| `scc` present | 10,201 — across **8 distinct values**; one (`10083664874139`) on **6,923** products; **540 fail their own check digit** |

One measured example: **UPC `081128001032`** is published against a 50 ml *Van Gogh
Fruit Sampler*, a 50 ml *Van Gogh Dessert Sampler* **and** a 1,000 ml *Woodford Reserve
Holiday 2026* from a different supplier.

**Being well-formed is not being unique.** Every one of those codes is valid, and 19%
of them are ambiguous. That is the whole argument against a `UNIQUE (namespace, value)`
index, and it was measured rather than reasoned.

### What the other exact-key sources carry

| Source | Its keys | UPC? |
|---|---|---|
| Iowa Liquor Products | `item_no`, **`upc` (GTIN-12)**, `scc` (junk) | yes |
| Michigan LCC price book | `LIQUOR CODE`, `ADA #` | **no** |
| Oregon OLCC | `itemcode`, `extendeditemcode` | **no** |
| California ABC beer posting | posting `id` | **no** |
| Defra wholesale | category / item / variety | **no** |

### Four normalisers already exist, and none carries a format

1. `public.wine_signature_hash()` + `wine_normalize_text()` (SQL) — library dedup;
   producer|name|vintage|type|grape|country|region, **empties dropped**.
2. `public.beverage_identity_key()` (PL/pgSQL, mirrored in
   `scripts/eval_merge_policies.py`) — the beverages residual-token key.
3. `buildWineIdentity()` (`vendor-intel/wine-identity.ts`) — the fixed-position
   producer|name|vintage key the price register uses.
4. `normaliseName()` / `sameProduct()` (`vendor-intel/bottle-size.ts`) — the page gate.

Measured coverage of the third: `identity_status` on the library is `normal` 3,875 /
`under_identified` 351; on beverages 508 / 100. And the producer|name|vintage key
collapses **3,562 live library rows to 3,525 keys — 34 keys hold 71 rows, worst 3.**

This file adds **no fifth normaliser**: `beverage-identity.ts` imports
`normalizeIdentityText` from (3) and adds only the two axes none of the four has.

ADR 0070 §"What was NOT decided" left a note *"for whoever takes it up"*, and this is
that person: it records that the argument against a supertype — *"that it forces an
identity model up front"* — **was refuted**, because `master_wine_library.id` is a
surrogate uuid whose content key arrived twelve days later. The same reasoning runs
here in the other direction: an identity register can be added beside tables that
already exist, which is why nothing in this build changes the library's own shape.
(For the record, the library carries `identity_status`, `signature_hash` and
`signature_source` — there is no `identity_key` column on it.)

## Decision

**A bottle's identity is `producer · name · vintage · size · pack`, it lives in its own
register, every code that names it is a row rather than a column, and a link is made by
a person or by an unambiguous key — never by a score.**

### The shape

* **`beverage_identities`** — one row per distinct **trade item**, not per wine.
  `identity_key` is a GENERATED column,
  `producer|name|vintage|size|pack`, with `size?`/`pack?` markers so an unstated part
  stays visible instead of becoming a default. `vintage_text` has **three** values —
  a year, `nv` (an assertion), `unstated` (the source's silence). Every row carries
  `asserted_by · asserted_at · assertion_method · assertion_confidence ·
  assertion_note`.
* **`beverage_identity_keys`** — GTIN, LWIN, TTB COLA, a source's item code, our own
  row ids, each as `(key_namespace, key_class, key_value)`. **Unique on
  `(namespace, value, identity_id)` and deliberately NOT on `(namespace, value)`.**
  A GTIN is normalised to GTIN-14 with its check digit **verified** before storage;
  an LWIN is parsed for shape only, because Liv-ex does not publish its check digit
  algorithm and a check we invented would reject valid codes.
* **`beverage_identity_candidates`** — `(subject_table, subject_id, identity_id,
  method, confidence, evidence, status)`. `status` starts `pending` at **every**
  confidence. A decided row must be **dated**, enforced by the CHECK
  `bic_decision_is_dated`; the service refuses a decision with no user id, and
  `decided_by` stays nullable only so that removing a person cannot force a fake
  author -- a NULL there means "the person was removed", never "nobody decided".
* **`identity_id`**, nullable, on `restaurant_inventory`,
  `vendor_price_observations` and `price_index_postings`. Nothing is backfilled, and
  the migration's own assertion block **fails if any row is written**.
* **The library and `beverages` get no column.** They reach an identity through the
  keys table (`mudavym:master_wine_library`, `mudavym:beverages`), so one library row
  may name a 750 and a magnum, and several rows may name one bottle. This is the
  rejected alternative in §Rejected, and the measurement above is why.

### The join

`joinByExactKey` returns **joined** (one identity), **ambiguous** (more than one —
a refusal, with candidates queued at 1/n) or **unknown_key** (*"not yet recorded"*,
never *"no such bottle"*). `proposeCandidates` blocks on a distinctive producer word,
then scores producer 0.35 + name 0.40 + vintage 0.15 + size 0.05 + pack 0.05 —
with **disqualifiers that beat scores**: if both sides state a size, a pack or a
vintage and they differ, the pair is not a weaker match, it is a different trade item
and is not a candidate at all. Any unstated part caps the score at **0.6** and the
evidence names which part.

**There is no model, and that is the finding rather than the shortcut.** WDC Products
says matchers *"struggle with unseen entities"*; every bottle here is an unseen entity,
there is not one labelled pair in the estate, and a person confirms each link either
way. A transparent score with its evidence beside it is worth more than an opaque one
that is right slightly more often. When a confirmed corpus exists, this function is
what produced it.

### The reader

`priceBelowAverage` prefers `identity:<uuid>`, falls back to `wine:` then `sig:`, and
**reports which per item and in one sentence** (`keyedBy`, `groupingNote`). This is
ADR 0119 Q7 answered by construction: a 12 × 375 case and a 6 × 750 case are two keys,
so `normalizeUnitPrice`'s per-750 scaling can no longer average them together.

### The first fill

`scripts/backfill_identity_source_keys.py` transcribes the **recorded** Iowa and
Michigan fixtures into identities and keys. Dry by default; `--emit-sql` writes a file
a person reads; `--apply` is refused without `--i-have-the-founders-word` **and** an
explicit `--dsn`, refused outright for the production host, and refused again because
no writer is implemented. It does **not** deduplicate by GTIN — that is the state the
joiner is built to refuse.

## Consequences

**Easier.** An index line can finally answer *"what does this bottle cost elsewhere"*
for a named bottle, because both sides key on the same thing. A shop sweep gains a
subject: it reads the pages for the identities the house has confirmed (Q28's answer).
Format stops being a scale factor. A new source costs a `key_namespace` string.

**Harder / given up.** Nothing joins until somebody confirms something. The register
starts empty and its status route says so in words rather than rendering a zero. The
house item cannot be identified from its own columns at all (measured below), so the
identity has to come through its library row. And the whole thing is dark until the
migration is applied, which is not this session's to do.

**What would trigger revisiting.** (a) A licensed feed arriving with LWINs already on
it, which would make the register's first fill an import rather than an assertion.
(b) A measured confirmed corpus above a few thousand pairs, which is the point where
the WDC finding stops applying and a learned matcher becomes worth testing.
(c) A source whose codes are genuinely unique, which would make the ambiguity design
look like overhead — Iowa says that source does not exist yet.

## What was tried against this decision

**The strongest attack is that the join joins nothing, and it lands.** Measured through
the real code against real production rows (a temporary probe, created, run and
deleted):

| Measurement | Result |
|---|---|
| `master_wine_library` rows carrying any code | **0 of 3,562** |
| beverages readable as an identity | **608 of 608** |
| library rows readable as an identity | **3,561 of 3,562** (1 has no producer) |
| library rows → distinct identity keys | 3,562 → **3,523** |
| **`restaurant_inventory` readable from its own columns** | **0 of 206** — 153 no producer, 53 no name |
| `restaurant_inventory` readable **through its library row** | **205 of 206** |
| **beverages getting any candidate against the fixture register (41 identities)** | **0 of 608** — 574 refused at blocking, 34 blocked but below floor |
| `beverage_identities` on production | **ABSENT** — *"Could not find the table 'public.beverage_identities' in the schema cache"* |

So: the only exact-key source the estate has (Iowa) is 100% spirits, and it proposes
**zero** links to the house's own 608 beverages. The counter-argument is that this
builds a join for data nobody has.

**What survives it.** Three things. (1) The alternative is worse in a measurable way:
`vendor_price_observations` is at 0 rows *today*, and ADR 0117's own order of filling
starts with the house's own invoices — every one of those sightings will be written
with a key, and adding the key column after the rows exist means re-deriving every
stored comparison, which is exactly the argument `vendor_price_observations` itself
makes for `yield_factor`. (2) The zero is *reported*, not hidden: `identity/status`
says the register is empty and why, and `groupingNote` says every comparison is still
grouped the old way. (3) The measurement above is itself the deliverable — before this
session, "the library has UPCs" and "the house item can be identified" were both
assumed, and both are false.

**The second attack: `beverages.identity_key` already exists, so this is a fifth
implementation.** It is not, and the difference is measurable: that key is
producer+name residual tokens with **no vintage, no size and no pack**, it exists only
on `beverages` (608 rows, none of them wine), and it has 583 distinct values for 608
rows — it is a *merge* key for one table, not a cross-source identity. This register
imports the normaliser it needs and adds the two axes every standard says are identity.

**The third: why not put `identity_id` on the library row?** Because the library's own
size column is 750 on 100% of its rows and a wine sold in two formats is two trade
items. A column would force the library to pick one. Rejected in §Rejected.

## Rejected alternatives

1. **Identity as columns on `master_wine_library`.** Cheapest, and it is the shape the
   library already half-has (`upc`, `ean`, `barcode`, `sku`, `distributor_skus`, all
   empty). Rejected on two measurements: the library's `bottle_size_ml` is a default on
   4,226 of 4,226 rows, so the row cannot state a format; and one row must be able to
   name several formats, which a column cannot express. It also leaves `beverages`
   (608 rows, all spirits and beer) with no identity at all.
2. **`UNIQUE (key_namespace, key_value)` on the keys table.** The obvious design, and
   the measurement kills it: 1,736 of Iowa's 9,118 distinct UPCs name more than one
   product and 343 of those span different volumes. A unique index would make a writer
   choose one of three silently — a coin toss recorded as a fact.
3. **Fuzzy auto-merge above a threshold.** Rejected on the founder's standing rule and
   on the evidence: CellarTracker and Vivino both put a person at the end, and WDC
   Products reports that every matcher struggles precisely on the unseen entities this
   register is made of. A confidence is not a decision, so `status` starts `pending` at
   every score.
4. **A table per source (`iowa_item_keys`, `michigan_codes`, …).** Rejected against the
   founder's own words — *"thinking there might be more in future"*. Five sources are
   already in the repo and each new one would be a migration, a model and a reader. A
   namespace is a string.
5. **A learned matcher (Ditto-style).** Rejected for now, with the condition for
   revisiting written down: no labelled pairs exist, every entity is unseen, and a
   person confirms every link regardless — so the model would buy latency and opacity
   and no decision.
6. **Reusing `signature_hash` as the identity.** It is producer|name|vintage in fixed
   positions and carries no format; keeping it as the *fallback* key (which the reader
   does) costs nothing, and promoting it to *the* identity would encode ADR 0119 Q7's
   defect permanently.
7. **Treating a TTB COLA id as the identity.** A COLA identifies a **label**, TTB says
   so, and the registry host refused this fetcher today. It is admitted as a key
   namespace and is not the identity.

## Founder-only questions

1. **The LWIN licence is answered — do we take the database?** It is **CC BY 4.0**,
   free, redistributable, commercial use allowed, attribution required (read today at
   `liv-ex.com/lwin/lwin-creative-commons/`), and it covers *"over 200,000 wines and
   spirits"*. Taking it would give the register a real first fill for **wine**, which
   Iowa and Michigan cannot. It also means carrying an attribution string on derived
   rows (the constant is written) and a download that is not in this repo. Take it,
   and if so as a one-off recorded file or as a periodic fetch?
2. ~~**Who confirms a candidate?**~~ **ANSWERED 2026-09-05 (batch 47), and BUILT.**
   The founder: **"staff may confirm, log the decisions."** See §"Q2, answered" below.
3. ~~**The house item's relation to the identity (ADR 0115).**~~ **ANSWERED 2026-09-05
   (batch 48), and BUILT.** The founder: **"Provisional on the item, curated into the
   library."** See §"Q3, answered" below.


4. ~~**Q28 itself: what should the sweep read now?**~~ **ANSWERED 2026-09-05
   (batch 49), and BUILT.** The founder: **"LWIN search + hand nominations."**
   See §"Q4, answered" below.


5. **A 12 × 375 case and a 6 × 750 case are now two keys — is `price_history` next?**
   ADR 0119 Q4 asked whether `price_history.unit` stays hardcoded `'BOTTLE'`. Grouping
   by identity in the ladder makes the two tables disagree about what a price is a
   price *of*. Fixing that is a separate change and is not in this one.

---

## Q2, answered: staff may confirm, and every decision is logged (2026-09-05)

The founder's words, verbatim: **"staff may confirm, log the decisions."**

### Why the two gates differ, stated rather than left to be inferred

Everything else under `/vendor-intel` is owner/manager, and that is not an
accident this change is undoing. Those routes expose **what a vendor quoted this
house** — its negotiating position, the same reason the pricing column carries a
role gate. A candidate exposes none of that: it is the question *"are these two
bottles the same bottle"*, and it carries no price, no vendor and no terms. The
people who can answer it are the ones holding the bottles.

So the gate is drawn by **what the route exposes**, not by the module it sits in:

| Route | Who | Why |
|---|---|---|
| `GET  /vendor-intel/identity/candidates` | owner · manager · **staff** | Confirming without being able to see the queue is not a capability, so the queue moves with the decision. |
| `POST /vendor-intel/identity/candidates/decide` | owner · manager · **staff** | The founder's call. No price is visible on a candidate. |
| `GET  /vendor-intel/identity/decisions` | owner · manager · **staff** | A person who takes a decision has to be able to see the decisions. |
| `POST /vendor-intel/identity/decisions/undo` | owner · manager | Taking a decision back is a supervisory act; it is also refused inside `IdentityService.undo`, not only by the decorator. |
| `identity/status`, `identity/lookup`, `identity/suggest`, `identity/assert`, and every other `/vendor-intel` route | owner · manager | Unchanged. `assert` MINTS an identity rather than confirming one, which is a different act from the one the founder opened. |

### The log, and the one thing it had to be able to survive

`beverage_identity_candidates` already carried `status`, `decided_by`,
`decided_at` and `decision_note` — and those are the **current state of one
proposal**, which is exactly what an undo destroys. The table's own
`bic_decision_is_dated` CHECK says a `pending` row has NO decision recorded, so
returning a candidate to pending must clear `decided_by`/`decided_at`. **A
manager who undid a confirmation would erase the confirmation.**

So `beverage_identity_decisions`
(`supabase/migrations/20260906030000_a_confirmation_is_a_logged_decision.sql`)
is the event log beside that projection. It adds only what was missing, and the
overlap with the candidate row is one row's worth of who/when for the latest
decision — which is the point, since that overlap is what makes an undo
reversible without forgetting:

* **the action**, including `undone`, which the candidate cannot express;
* **the actor's role and name AS THEY WERE.** `decided_by` is `ON DELETE SET
  NULL` everywhere in this repo, so a person who leaves would take "who
  confirmed this" with them. `decided_by_label` and `decided_by_role` are
  NOT NULL, and a decision from an account with neither a name nor an email is
  **refused** rather than logged against a placeholder;
* **the evidence the person saw** — the candidate's method, confidence and
  evidence plus the identity and subject it named — captured **server-side**
  from the same rows the queue route rendered. Never taken from the request
  body: a client-supplied *"here is what I saw"* is an attestation, not a
  record. When the identity row cannot be read the log still lands, with
  `{ unread: true, reason }` in its place — a decision that happened must be
  logged even when the decoration around it could not be fetched;
* **the link back** from an undo to the decision it reverses
  (`bid_undo_names_its_decision`: only an undo names one and every undo must;
  `uq_beverage_identity_decisions_undo`: a decision is undone at most once, so
  two managers racing cannot take one link back twice).

**Append-only, enforced by a trigger** that raises on UPDATE and DELETE, proved
in the migration's own `DO $$` block against a real UPDATE rather than asserted.
The consequence is stated instead of discovered: `restaurant_id` is `ON DELETE
RESTRICT`, so a house holding identity decisions is retired by soft delete and
never hard-deleted — ADR 0115's rule for the library link.

The undo takes the link back before it logs: a column link returns to NULL
(filtered on **both** the subject id and the identity id, so an undo cannot
blank a link somebody else wrote), and a key link is **deleted**, because the
keys table has no state — a key is an assertion and withdrawing one is removing
it. The undo row names which of the two happened.

### The read

`GET /vendor-intel/identity/decisions` returns this house's decisions plus those
on the public registers, newest first, capped at 200. **A failed read throws
with its reason.** An empty array would say *"nobody in this house has ever
decided anything"*, which is a claim; a query that failed has made no claim at
all. The response also carries `complete`, false when the page came back full,
because `items.length` behind a `.limit()` is a floor and not a total.

The register page's own list is `apps/web/src/pages/IdentityDecisionLog.tsx`,
mounted on `/vendor-prices` **outside** the comparison's data branch — the log
is a fact about the house and stays readable when no wine is picked and when the
ladder itself fails, which is when somebody is most likely to be asking who
confirmed what. It prints the failure and its reason rather than an empty list,
reads "at least N" when the page was capped, hides the undo control from staff
with a sentence saying why (the gateway refuses independently, so hiding it is a
courtesy and not the protection), and its query key carries the active house so
`switchRestaurant` cannot serve the previous one's log from cache.

### Rejected

1. **Owner/manager only** — the status quo. Rejected by the founder. Recorded
   because it was the shipped behaviour until this change and the argument for
   it (identity work touches the same module as pricing) is a fact about our
   file layout, not about what the route exposes.
2. **Staff proposes, a manager confirms.** The obvious middle, and it is worse
   in a way that is specific: `proposeCandidates` already generates the
   proposals mechanically, so "staff proposes" would be staff pressing a button
   that runs a function, and the only judgement in the flow — *is this the same
   bottle* — would still sit with the person furthest from the shelf. It also
   doubles the queue depth for no new information.
3. **A confidence threshold above which staff may confirm.** Rejected on this
   ADR's own decision: a confidence is not a decision, and a threshold that
   changes WHO may decide is a threshold that decides.
4. **Logging by mutating the candidate row** (adding `decided_by_role`,
   `decided_by_label` and an `undone_at` to it). Rejected on the measurement
   above: the CHECK that makes `pending` mean "no decision recorded" is what
   makes the row honest, and an undo would still erase the history it is meant
   to preserve.

---

## Q3, answered: provisional on the item, curated into the library (2026-09-05)

The founder chose **"Provisional on the item, curated into the library
(Recommended)"**, whose option text reads: *"As described: item-level identity
is provisional and named; a curation queue; promotion re-points the item;
provenance kept; a provisional identity is printed as such everywhere it
appears, never as official."* His own words that led there (batch 48): *"do
option 1, + let each restaurant to name their products to match their likings,
eg. instead of 1988 Wine X ... restaurant maybe they would prefer to name it:
Wine X only and so on. maybe the /menu is editable, but masterwinelibrary parts
/wines not at all."*

### What already existed, and is therefore not rebuilt

ADR 0130 shipped the LIBRARY side of this the same day:
`master_wine_library.provisional_for_restaurant_id` marks a row as one venue's
own, keeps it out of every other venue's matching, and is cleared on promotion.
Nothing here duplicates it. This is the IDENTITY side — the thing ADR 0124
introduced and ADR 0130 does not touch. The two columns share a name on
purpose: `provisional_for_restaurant_id` means one thing in this repo, and a
synonym would be a second word for one fact.

### The shape

`supabase/migrations/20260906050000_a_house_may_name_a_bottle_the_library_does_not_have.sql`
adds to `beverage_identities`:

* **`asserted_for_restaurant_id`** — the house that named the bottle. Written
  once and **never cleared**. This is the founder's "provenance kept", and it is
  a separate column from the state for a measured reason: ADR 0130 promotes by
  *clearing* its provisional marker, so one column doing both jobs would erase
  the house's assertion at the moment of promotion.
* **`master_wine_id`** — the shared library row a promotion attaches it to. This
  is the many-to-one side of the relation whose other side ADR 0124 deliberately
  keeps as a KEY: one library entry, several trade items (750 ml and magnum).
* **`curation_state`** (`none` · `queued` · `promoted` · `declined`),
  `curated_by`, `curated_at`, `curation_note`.
* **`standing`, GENERATED** — `library` once promoted, `provisional` while it is
  a house's own, `source` when transcribed from a published file. Generated,
  because *"printed as provisional everywhere it appears, never as official"* is
  only true if the thing being printed cannot drift from the facts.

**Three standings and not two, deliberately.** The founder named two. Collapsing
everything that is not provisional into "official" would call an Iowa
transcription an official library entry — the exact class of falsehood this
register exists to stop — so a row that is neither a house's assertion nor
promoted says what it is.

**The queue is a query, not a table** (`WHERE curation_state = 'queued'`, oldest
first). A queue table would carry its own copy of "is this waiting", which can
disagree with the identity's own state; there is one fact and it lives on the
row.

### Who curates, and why it is a key rather than a role

`identity-curation.controller.ts`, its own controller with **no class-level
guard**, each route `@Public()` + `@UseGuards(ServiceKeyGuard)` +
`X-Admin-Key` — the ADR 0099 service credential, the same shape as
`POST /communications/email` and the experiment both-arms report. Splitting the
controller is not cosmetic: `VendorIntelController` carries
`@UseGuards(JwtAuthGuard, RolesGuard)`, Nest requires every class guard to pass
before a method guard runs, and `RolesGuard` reads `request.user` — which a
service key does not carry. On the same controller these routes could not work.

**No platform-admin role is invented.** `RolesGuard` knows owner, manager and
staff, all three roles *within* a house; a fourth created to hold a curation
queue would be a permission system built as a side effect. The service key
already means "not a tenant", and it fails closed on an unset `ADMIN_API_KEY`.

### Promotion, in four steps, in that order

1. the library row is chosen or created; 2. the identity names it, which flips
`standing` to `library`; 3. **every house item carrying this identity is
re-pointed** (`restaurant_inventory.master_wine_id`) — the founder's "promotion
re-points the item"; 4. the curation is stamped. If (3) fails the call fails
**and says the identity was promoted**, because a half-done promotion reporting
success would leave an item pointing at the placeholder row forever. How many
items were re-pointed is returned and printed: zero is a real answer.

Promoting onto another venue's provisional row is **refused** — ADR 0130's own
rule, enforced from this side too, since it would move the identity from one
provisional state into another and call the result official. A **decline** keeps
the identity, keeps the house, and requires a reason, because "declined" with no
reason is a verdict the house cannot act on.

### Rejected

1. **"Provisional, and auto-promote on match."** Rejected by the founder, and it
   is the same fault this ADR already measured: an exact key is evidence, not
   proof — 1,736 of Iowa's 9,118 UPCs name more than one product. Auto-promotion
   on a match would put a machine's guess into the shared library, where every
   other house then inherits it.
2. **"Item identity is permanent."** Rejected by the founder. It would make the
   library unable to ever learn what a house already knows.
3. **A `beverage_identity_curation` queue table.** Rejected on retire-to-write
   and on correctness: a second copy of "is this waiting" can disagree with the
   identity's own `curation_state`.
4. **A platform-admin role in `RolesGuard`.** Rejected: see above.

---

## The naming rule: names are the house's, identity is the library's (2026-09-05)

The founder chose **"One alias on the item, library immutable (Recommended)"**,
whose option text reads: *"One house-owned display name per item, used
everywhere the house sees it (menu, inventory, orders); the library row and the
identity are untouched; both names searchable. One name to maintain; provenance
intact."* The rule as put to him: **"Names are the house's; identity is the
library's."**

### No column was added, because the column already existed

`restaurant_inventory.wine_name` is the alias. It has been there since the
baseline, and `inventory.service.ts:83` already reads
`row.wine_name || row.master_wine_library?.name` — the house's name first, the
library's as fallback. ADR 0130 had already made bulk receive write it from the
draft rather than from the row it resolved to.

**Measured read-only on production, 2026-09-05, before deciding:** 233
`restaurant_inventory` rows; `wine_name` present on **180**, **156** distinct
values, and **0 of them differ from the library's own `name`**. So the column
existed, was rendered, and carried no house-specific value anywhere — because
**nothing let a house set it**. `UpdateInventoryItemDto` had no such field.

That is the whole change: the DTO gains `wineName`, the update path maps it, and
an empty string **clears** the alias so the row falls back to the library name
rather than storing a name of `""`.

### Both names searchable, which needed a second value to travel

`wineName` collapses the two names into whichever one is displayed, so on its
own it makes the other unfindable: a house that renames *"1988 Wine X"* to
*"Wine X"* could no longer find it by searching *"1988"*. The item read now also
carries **`libraryName`** (the library's own name, matched but never rendered in
the alias's place) and **`houseAlias`** (whether the house has actually set one,
which `wineName` cannot express because it is non-null either way). The
inventory page's filter matches both.

### The library stays immutable from this path

Asserted rather than described: `house-item-alias.spec.ts` reads the real
`updateInventoryItem` body out of the source file and fails if it ever contains
`from("master_wine_library")`. A test that only exercised a copy of the branch
could not see a future edit that started writing the library, and the founder's
line — *"masterwinelibrary parts /wines not at all"* — is exactly about that.

### Rejected

1. **"Alias per surface"** (a different name on menu, inventory and orders).
   Rejected by the founder, and it multiplies the thing that has to stay true:
   three names to maintain and three ways for them to disagree about one bottle.
2. **"House-scoped copy of the library row."** Rejected by the founder. It is
   the shape ADR 0130 already had to contain — a venue-owned library row exists
   only because `restaurant_inventory.master_wine_id` is NOT NULL — and
   generalising it would give every house its own fork of the library and no
   shared identity at all.
3. **A new `display_name` column on `restaurant_inventory`.** Rejected on the
   measurement: `wine_name` is already there, already read, already preferred.
   A second column would be two homes for one fact, and the read would have to
   pick.

---

## Q4, answered: LWIN search + hand nominations (2026-09-05)

The founder chose **"LWIN search + hand nominations (Recommended)"**: *"A house
searches the LWIN file and confirms identities from it, and can also nominate a
wine by hand, each nomination becoming a named identity assertion (provisional,
per the curation rule). The sweep reads confirmed identities and says how many
it read. **Two ways in; nothing invented.**"* LWIN itself was settled in batch
43: **taken as a recorded one-off file, refreshed on a stated cadence** — not a
live fetch.

### Way one: the recorded LWIN file

`lwin-file.ts` reads a CSV, **validates its header against the columns it binds
to** and refuses a file it does not recognise BY NAME rather than parsing it
into empty strings. Every bad row is refused and counted by reason
(`lwin_not_seven_digits`, `no_display_name`, `no_producer`), so a house is told
"5 rows read, 3 refused" instead of a number that quietly means something else.
Search requires **every** word of the query to appear in the producer or the
display name, in any order — a prefix match would find neither *"margaux 2015"*
nor *"krug grande cuvee"* — and a year in the query is matched as a word and
**never as a vintage filter**, because an LWIN-7 names the wine and carries no
vintage at all.

**Confirming a row takes the wine from the file and the FORMAT from the house.**
The vintage, size and pack come from the bottle in front of the person. The
identity's standing is `source`, not `provisional`: it came from a published
file, so it is nobody's house assertion and it does not enter the curation
queue. The CC BY 4.0 attribution travels on the key row, the same rule Iowa's
licence gets in the sibling register.

### There is no LWIN file in this repo, and that is stated rather than papered over

Probed 2026-09-05 with an identifying UA: the LWIN page (147,184 bytes) carries
**no `.csv`, `.xlsx` or `.zip` link at all**, and three guessed paths under
`wp-content/uploads` and `/lwin/download/` returned **404**. Liv-ex serves the
database through a form. So a person downloads it, points `LWIN_FILE_PATH` at
it, and refreshes it on the recorded cadence — and until then the search route
answers `available: false` with the path, the licence and where to get it,
**never an empty hit list**: "no wine matched your words" and "there is no file
on this deployment" are different answers and only the first is about the wine.

The committed fixture is **synthetic and named so**, in a `99xxxxx` code block,
with the reason in its own header. Not one row claiming to be Liv-ex's is in
this repo — inventing them would be a falsehood wearing a fixture's clothes, and
a licence problem wearing a data problem's.

### Way two: a hand nomination

`POST /vendor-intel/identity/nominate` is `assertIdentity` with the house
attached, which by Q3's rule makes it **provisional** and queues it for
curation. It is its own route because the response says the standing out loud: a
house that nominates a bottle is told in the same breath that what it just made
is provisional and will be shown that way until Mudavym promotes it.

### What the sweep reads, and how many

`GET /vendor-intel/identity/sweep-subjects` counts identities whose standing is
`library` or `source` — **provisional ones are excluded**, because a house's own
unconfirmed name is not a subject to go fetching prices for. Zero is reported as
a real zero with the reason ("identities are confirmed by people ... nothing
fills the register on its own"), and a failed count returns null with its
message rather than 0.

**This is the answer to ADR 0117 Q28.** The sweep's subject list is the confirmed
identities, and it says how many it read.

### Rejected

1. **"Leave it empty until invoices fill it."** Rejected by the founder. It is
   also the option this ADR's own counter-argument section already conceded was
   the slow path: class A fills only as the house receives paper.
2. **"Nominations only, no LWIN search yet."** Rejected by the founder. It would
   make every wine a house's provisional assertion needing curation, which puts
   the whole 200,000-wine public catalogue through a queue one person runs.

---

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (research + build, the identity join) | **Q28 ANSWERED and BUILT.** Founder: *"Do the SOTA and best for scalability thinking there might be more in future."* Twelve standards/vendor/paper sources fetched today (GS1 GMS 1.1 §2.3/§2.8 as a 381,277-byte PDF from `ref.gs1.org` after `www.gs1.org` 403'd twice; LWIN's CC BY 4.0; CellarTracker's three failure modes; Vivino's manual-review sentence; AWS Entity Resolution; SC-Block, Ditto, WDC Products), with **three refusals recorded rather than worked around** — `wine-searcher.com/trade/api` 403, `ttbonline.gov` connection reset, and Liv-ex's own LWIN page no longer publishing the digit structure (recorded from a SECONDARY source and flagged). **The measurement that decided the shape:** the live Iowa file (5,425,785 B, 13,762 rows, `report_as_of` 2026-09-01) carries a check-digit-valid UPC on **100%** of rows and **1,736 of its 9,118 distinct UPCs name more than one product**, 343 of them across different volumes — so the keys table is deliberately not unique on `(namespace, value)` and `joinByExactKey` refuses an ambiguous key at 1/n. **The measurement that killed the obvious alternative:** `master_wine_library.bottle_size_ml` is **750 on all 4,226 rows** (one distinct value, the column default) and only 2 of 3,562 live rows name a format anywhere, so identity cannot live on the library row. **The measurement that is the strongest counter-argument, run through the real code against production:** the fixture register (41 identities) proposes **0 candidates for 608 real beverages**, and `restaurant_inventory` is readable as an identity **0 of 206** times from its own columns but **205 of 206** through its library row. Built: the migration (3 tables + 3 nullable FKs, RLS on, anon/authenticated revoked in-file, an assertion block that **fails if any row is written** and that proves both the generated key and the one-GTIN-two-identities case inside a rolled-back probe), `beverage-identity.ts` (importing the existing normaliser rather than adding a fifth), `identity-join.ts`, `identity.service.ts`, five routes on the existing owner/manager controller, the reader change with `keyedBy`/`groupingNote`, and a dry-by-default backfill script. **Verification on this tree:** `npx jest --runInBand --forceExit src/vendor-intel` → **302 passed / 16 suites**, of which **53 in 3 suites are new here**; `tsc --noEmit -p tsconfig.spec.json` **0 errors**; `eslint --quiet` clean on 8 touched files; emoji grep empty; nine python guards exit 0 and `check_gateway_boots.sh` **PASS**. `check_queried_tables_exist.py` **caught this build** with three `.from(<variable>)` sites in `identity.service.ts` (unresolvable set 26 → 29) — proved pre-existing-clean by exporting HEAD with `git archive` to `$SP/p4aq/head-tree`, where it exits 0; refactored to literal branches, now exits 0 here too. **NOT verified, and stated:** there is no Docker daemon and no local Postgres on this machine, so the migration was **never applied** — it parses under libpg_query (`pglast` 7.18: 39 statements + 1 PL/pgSQL body) and nothing more; and the process on `127.0.0.1:4000` answers **404 to every gateway route including `/auth/me`**, so **no live curl was made**. Five founder questions. |
