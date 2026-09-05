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


5. ~~**A 12 × 375 case and a 6 × 750 case are now two keys — is `price_history` next?**~~
   **ANSWERED 2026-09-05 (batch 49), and BUILT.** The founder: **"Yes, identity_id on
   `price_history` now."** See §"Q5, answered" below.

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

## Q5, answered: the house's own price series names the bottle too (2026-09-05)

**The founder, batch 49: "Yes, identity_id on `price_history` now."**
**Rejected: keep the two apart.**

### Why the fork was real, and why it still lost

The case for keeping them apart is not weak. `price_history` is the house's own ledger
of what **it** paid; `vendor_price_observations` is the market. They answer different
questions, they are written by different paths, and an `identity_id` on the house ledger
is dead weight for exactly as long as nobody has confirmed an identity — which, measured
on this tree, is *still true today*: `beverage_identities` holds zero rows and nothing
writes one unattended. A column that is NULL on every row for a year is the sort of
thing this repo has learned to treat as a lie waiting.

It loses on one asymmetry. **The cost of adding the column later is not the column.** An
`ADD COLUMN` is cheap whenever it happens. What is not recoverable is every row written
between now and then: those rows carry no identity, and no later migration can give them
one without inventing an assertion nobody made — the library link is a *transcription*
of somebody's assertion only while the row still has the `master_wine_id` the assertion
was about, and the joiner would refuse a guess. So the choice was between a column that
is briefly empty and a series that is permanently partly unjoinable. The founder took
the first.

The second half of the argument is the one Q5 itself wrote: with the ladder grouping by
identity and the house ledger only joinable by `master_wine_id`, **the two registers
disagree about what a price is a price of.** One `master_wine_library` row covers the
750 and the magnum — this ADR measured `bottle_size_ml` to be 750 on all 4,226 rows
because that is the column default, never a reading — so the house's own paper could
never be laid beside a vendor's sighting of the *same trade item*. That is precisely
what ADR 0117 Q28 asked the register to make possible.

### What was built

`supabase/migrations/20260906060000_a_price_names_the_bottle_it_priced.sql`.

**The column** is nullable with `REFERENCES beverage_identities(id) ON DELETE RESTRICT`,
no default — identical to the three columns `20260905140000` added, and asserted to be
so in-file (nullable, no default, FK present, index present). A NOT NULL here would force
a guess about every bottle nobody has identified, which is the failure the whole design
refuses.

**It backfills**, and the three siblings deliberately did not. The difference is not a
relaxation, it is the subject: a house item, a vendor sighting and a posting reach an
identity only through a person's judgement, whereas a `price_history` row already carries
`master_wine_id`, and this ADR's own keys table records the library link as
`('mudavym:master_wine_library', <library row id>)`. Where that key names **exactly one**
identity, writing it is transcription, not inference. Where it names none, or more than
one, the row is left NULL — `having count(distinct k.identity_id) = 1` is the whole rule,
and it is this ADR's ambiguity doctrine applied unattended: *an ambiguous exact key is a
refusal, never a choice.* A backfill that chose would write, at scale and with nobody
watching, exactly the answer `joinByExactKey` refuses to give with a person present.

**The count is recorded whether or not it changed anything** (ADR 0078). The `RAISE
NOTICE` fires unconditionally with four numbers — rows in the table, rows carrying a
`master_wine_id`, rows resolved and written, rows refused as ambiguous, rows left NULL —
and three assertion branches then re-derive them *from the table* rather than trusting
the variables that produced them. Without that, a backfill that resolved nothing would
leave no trace, and "no NOTICE" reads identically to "never ran".

**The index `(identity_id, unit)` is NOT partial**, and this is the one place the file
departs from its siblings' shape. `idx_vpo_identity`, `idx_price_index_postings_identity`
and `idx_restaurant_inventory_identity` are all `WHERE identity_id IS NOT NULL`, because
their readers filter to identified rows. The contract here is the opposite and explicit:
the reader groups by identity **and** unit and **prints the NULL group as
"unidentified"** rather than dropping it (ADR 0016, ADR 0020). A partial index would
serve every part of that query except the part the decision exists to protect.

### The readers: none, measured rather than assumed

`price_history` has **one writer and zero readers** on this tree —
`grep -rn 'from("price_history")|table("price_history")|from price_history|join price_history' apps services`
over `*.ts,*.tsx,*.py,*.sql` returns exactly one line, `recordPriceHistory`'s insert at
`procurement.service.ts:1434`. So no read gained an identity key, because there is no
read. The ladder and the market box join `vendor_price_observations`, which has carried
`identity_id` since `20260905140000`; nothing under `vendor-intel/`, `procurement/` or
`price-index/` was changed by this pass. The orchestrator's `_get_price_history` reads
`procurement_orders.price_per_bottle` — a different table that shares the phrase.

### The rule is held by a guard instead

`scripts/check_price_history_reads_group_by_unit.py` (the ADR 0119 Q4 guard) gained a
**second arm**, because Q5 creates a new way to commit the original defect that *looks*
like diligence: **group by `identity_id` alone and average.**

An identity fixes **what the bottle is**. A unit fixes **what the number counts**. One
identity can be bought by the bottle in March and by the case in April, and those two
rows are both honest, both correctly identified, and not addable. So grouping by identity
without unit is the same fault as grouping by nothing.

That arm reports **exit 1, not exit 2** — deliberately. The guard refuses (exit 2) when
it cannot follow a grouping key; here the key is visible, and visibly insufficient, so a
refusal would be a dodge. Both spellings (`identity_id`, `identityId`) and the raw-SQL
form (`GROUP BY identity_id` with no `unit`) are covered.

### Proved, not argued

A PGlite probe (`p4-scratch/pglite-probe/p4-price-identity.mjs`, the harness shape of
`apply-and-probe.mjs`) applied the migration against a real Postgres in four scenarios
and **caught two defects before this file was applied anywhere**:

1. `min(uuid)` does not exist in Postgres (42883). The single-candidate pick is now
   `(array_agg(distinct k.identity_id))[1]`, which the `HAVING` guarantees is a read of
   the only candidate rather than a choice.
2. The idempotency assertion was wrong: re-applying the file read its own earlier
   backfill as somebody else's write and raised. It now counts identified rows
   **before** the update and asserts `final = pre + written`.

What the probe then showed, on four seeded rows: one resolvable library key **written**,
one ambiguous key (750 vs magnum — this ADR's own example) **refused and left NULL**, one
key with no identity and one row with no `master_wine_id` **left NULL**; the mandated read
`group by identity_id, unit` returning the NULL group as `unidentified` beside the
identified one; a second apply changing nothing; the FK refusing a phantom identity
(23503); and both `RAISE EXCEPTION` guards firing — the missing-parent check and the
ambiguity check.

**Stated rather than hidden: PGlite 0.5.x does not surface `RAISE NOTICE` to the client.**
`PGlite.create({ onNotice })` never fires and `exec()` returns only
`{rows, fields, command, affectedRows}` — measured. So the probe cannot prove the NOTICE
**text**; it re-derives the four numbers it reports from the same expressions and prints
them, and every assertion guarding those numbers *is* proved, because a raised exception
is observable. The NOTICE text itself is unverified and named here as such.

### The writer names it too — otherwise the column stopped filling the day it was made

The step above left `price_history.identity_id` correct and permanently frozen: the
backfill is a one-time act, and `recordPriceHistory` — the table's only writer — did not
name the column at all, so every row written from 2026-09-05 onwards would have carried
NULL forever. Measured on the pre-fix file (`git show HEAD:` copy at `c2c5725e`,
298,781 bytes): `grep -c identity_id` returns **0** — absent from the whole file, not
merely from the insert, whose eleven keys are transcribed in the spec. `recordPriceHistory`
now resolves the bottle at write time through the **same** rule the backfill used, and by
**importing** `joinByExactKey` from `vendor-intel/identity-join.ts` rather than
re-implementing it: one distinct identity joins, more than one refuses, none stays NULL.
Nothing this resolution returns can suppress the row — a register that could not be read
is UNKNOWN, so the failure is said in words, a sentence goes onto the row's `notes`, and
the price is still written with `identity_id` NULL; a failed analytics read must never
cost the house the record of what it paid. The `unknown_key` branch is the one silent
branch, deliberately: `beverage_identities` holds 0 rows in production, so a warning there
would fire on every price the platform records. The one thing that could still drift is
the namespace literal, which now has three spellings (the writer's constant, the private
map in `IdentityService`, the migration's own literal); it is pinned by an executable
`ADR-0124` row in `CLAIMS.jsonl` — the device ADR 0125's row uses for `DECLINE_INTENTS` —
which also asserts that both halves of the one-key rule are still written where they are
cited, and which was proved to discriminate against copies with either the namespace or
the rule altered.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (build, Q5: the WRITER names the bottle) | **The other half of Q5, built (batch 54, founder: "Dispatch it now").** The migration's backfill was a one-time act and `recordPriceHistory` never named the column, so every row after 2026-09-05 would have been NULL forever. The writer now resolves the bottle at write time through the SAME rule, by **importing** `joinByExactKey` from `vendor-intel/identity-join.ts` (nothing under `vendor-intel/` was edited): one distinct identity joins, more than one REFUSES, none stays NULL, and **no branch can suppress the row** — a register that could not be read is UNKNOWN, logged in words, noted on the row, price written with `identity_id` NULL. `unknown_key` is the one silent branch on purpose (`beverage_identities` holds 0 rows in production; a warning would fire on every price). The namespace literal now has three spellings and is pinned by an executable `ADR-0124` row in `CLAIMS.jsonl`, **proved to discriminate**: copies of the three files with the writer's namespace drifted, or with the joiner's `identityIds.length === 1` altered, both exit 1 where the real tree exits 0. **Pre-fix proof, no revert on a shared worktree**: `git show HEAD:.../procurement.service.ts` at `c2c5725e` (298,781 B) has `grep -c identity_id` = **0**; the new spec run against a same-depth copy of that file fails **5 of 6** (only the transcription case passes, which is the point) and the failing key list prints the pre-fix eleven; the probe files were deleted. **Measured on this tree:** `npx jest src/procurement src/vendor-intel` **1338 passed, 3 skipped, 1341 total / 71 suites passed + 1 skipped**, of which **6 are new** (`a-price-names-its-bottle.spec.ts`); gateway `tsc --noEmit -p tsconfig.json` **0 errors**; `-p tsconfig.spec.json` **11 errors at 6 sites in 3 files, none of them mine** — all in `communications/text/**` and `notifications/producers/**`, whose services other builders have modified in this shared worktree; `check_read_columns_exist`, `check_price_history_reads_group_by_unit` (**0 identity-keyed reads, 0 readers**), `check_read_errors_not_swallowed` (191/191 baselined, 0 new), `check_queried_tables_exist`, `check_order_capture_contract` all exit 0; `check_decision_claims.sh` **240 checked, 240 holding**; `check_gateway_boots.sh` **PASS**; `eslint --quiet` exit 0 on both touched files. |
| 2026-09-05 | Claude (build, Q5: identity_id on price_history) | **Q5 ANSWERED by the founder (batch 49) — *"Yes, identity_id on `price_history` now."* — and BUILT.** Rejected: keep the two apart; the losing argument is conceded in full in the section above rather than caricatured. `20260906060000_a_price_names_the_bottle_it_priced.sql` adds the column nullable with an ON DELETE RESTRICT FK, backfills ONLY through an unambiguous `mudavym:master_wine_library` key (`having count(distinct identity_id) = 1` — an ambiguous key is this ADR's own refusal, applied unattended), RAISEs the four backfill numbers unconditionally (ADR 0078) and re-derives them from the table in three assertion branches, and indexes `(identity_id, unit)` NON-partially because the NULL group is PRINTED as "unidentified", not filtered away. **No reader changed, and that is measured**: `price_history` has one writer and ZERO readers (`grep -rn 'from("price_history")|table("price_history")|from price_history' apps services` returns one line, the insert); the ladder and market box read `vendor_price_observations`, which has had `identity_id` since 20260905140000; `vendor-intel/`, `procurement/` and `price-index/` untouched. The rule is held by a guard instead: `check_price_history_reads_group_by_unit.py` gained an arm making `identity_id` without `unit` exit 1 (not 2 — the key is visible and visibly insufficient), both spellings and the raw-SQL form. **The PGlite probe found two defects before this was applied anywhere**: `min(uuid)` does not exist (42883), and the idempotency assertion misread its own earlier backfill on a second apply. 12 probe outcomes green, including both RAISE EXCEPTION guards firing. Guard PASS + 12-branch self-test; 21 pytest cases. **Named as unverified**: PGlite 0.5.x does not surface RAISE NOTICE, so the NOTICE text is unproved — its four numbers are re-derived and printed instead. |
| 2026-09-05 | Claude (build, Q3 + the naming rule + Q4) | **Three founder decisions of batches 48-49, built in order, each proven before the next.** **Q3 — *"Provisional on the item, curated into the library"*:** `20260906050000_a_house_may_name_a_bottle_the_library_does_not_have.sql` adds `asserted_for_restaurant_id` (written once, NEVER cleared -- provenance, deliberately a different column from ADR 0130's `master_wine_library.provisional_for_restaurant_id`, which IS cleared on promotion because there it is state), `master_wine_id`, `curation_state/by/at/note`, and a **GENERATED `standing`** so *printed as provisional everywhere, never as official* cannot drift. **Three standings, not two**, because collapsing `source` into `official` would call an Iowa transcription an official library entry. The queue is a QUERY, not a table. Curation is `identity-curation.controller.ts`, its own controller with **no class-level guard**, each route `@Public()` + `ServiceKeyGuard` + `X-Admin-Key` (ADR 0099) -- splitting is not cosmetic: `VendorIntelController`'s class-level `RolesGuard` reads `request.user`, which a service key does not carry, so on that controller these routes could not work; and no platform-admin role is invented. Promotion is four steps and **re-points the items**, reporting how many; a failure at the re-point fails the call AND says the identity was promoted. Promoting onto another venue's provisional row is refused (ADR 0130's rule, enforced from this side). **The naming rule -- *"One alias on the item, library immutable"*: NO COLUMN WAS ADDED.** Measured read-only on production first: `restaurant_inventory.wine_name` exists, is already preferred over the library name at `inventory.service.ts:83`, is present on **180 of 233** rows with **156** distinct values and **0 differing from the library's own name** -- because nothing let a house SET it. `UpdateInventoryItemDto` now carries `wineName` (empty string CLEARS the alias), and `libraryName` + `houseAlias` travel beside it so **both names stay searchable** (rename "1988 Wine X" to "Wine X" and "1988" must still find it). A test READS `updateInventoryItem` out of the source file and fails if it ever contains `from("master_wine_library")`. **Q4 -- *"LWIN search + hand nominations"*:** `lwin-file.ts` validates the header and refuses an unrecognised file BY NAME, counts every row refusal by reason, requires every query word to appear, and matches a year as a WORD never as a vintage filter (an LWIN-7 carries no vintage). **There is no LWIN file in this repo and the route says so**: probed 2026-09-05, the LWIN page (147,184 B) carries no .csv/.xlsx/.zip link and three guessed paths 404 -- Liv-ex serves it through a form -- so `lwinSearch` answers `available:false` naming the path, the CC BY 4.0 licence and where to get it, never an empty hit list. The fixture is **synthetic and named so** in a 99xxxxx block. An LWIN confirmation stands as `source` (not provisional, no queue) with the attribution on the key row; a hand nomination is provisional per Q3 and the response says so; `identity/sweep-subjects` counts `library`+`source` only and calls zero a real zero. **Measured on this tree:** `npx jest --runInBand --forceExit src/vendor-intel src/inventory` **419 passed / 25 suites**, of which **70 in 4 suites are new across these three steps** (identity-curation 26, lwin-file 15, house-item-alias 9, identity-decisions 20 from the Q2 step); `npx vitest run src/pages/IdentityDecisionLog.test.tsx` **11 passed** (+3 for the provisional badge); `npx vitest run src/pages/inventory` **24 passed / 3 files**. Gateway `tsc --noEmit -p tsconfig.spec.json`: **0 errors in vendor-intel and 0 in src/inventory** (the tree's remaining errors are other builders' `communications`, `procurement`, `notifications`, `team` and `orders/next`). Eleven guards exit 0 including `check_route_exposure` (PASS, 0 undeclared -- it sees the three new service-key routes), `check_read_errors_not_swallowed`, `check_read_columns_exist` and `check_windowed_figures`; `check_gateway_boots.sh` PASS; `eslint --quiet` clean on every touched gateway file; emoji grep empty; migration prefix uniqueness empty. **NOT verified, stated:** no Docker and no local Postgres, so neither migration was ever applied -- the new one parses under libpg_query (10 statements + 1 PL/pgSQL body) and its standing probes are proved only by that block's own text; `127.0.0.1:4000` still answers 404 to every gateway route, so no live curl; and web `eslint` cannot run here at all (`eslint-plugin-jsx-a11y` missing, repo-wide). Q5 untouched -- it is another builder's. |
| 2026-09-05 | Claude (build, Q2: staff may confirm) | **Q2 ANSWERED by the founder — *"staff may confirm, log the decisions"* (batch 47) — and BUILT the same day.** The gate is now drawn by **what a route exposes**, not by the module it sits in: `identity/candidates`, `identity/candidates/decide` and `identity/decisions` admit **staff** (a candidate carries no price, no vendor and no terms, and confirming without seeing the queue is not a capability); `identity/decisions/undo` stays owner/manager and is refused a SECOND time inside `IdentityService.undo`, not only by the decorator; `identity/assert` stays owner/manager because it MINTS an identity rather than confirming one. **The log had to be a second table**, and the reason is the candidate table's own `bic_decision_is_dated` CHECK: a `pending` row has no `decided_by`/`decided_at`, so an undo must clear them — **a manager who undid a confirmation would erase the confirmation**. `beverage_identity_decisions` (`20260906030000_a_confirmation_is_a_logged_decision.sql`) is append-only by trigger, **proved in the migration's own DO block against a real UPDATE** and against an undo that names no prior decision, and adds only what was missing: the action (incl. `undone`), the actor's **name and role as they were** (`decided_by` is ON DELETE SET NULL — a foreign key that forgets is not an audit trail; an account with neither name nor email is REFUSED rather than logged against a placeholder), the evidence the person saw **captured server-side from the same rows the queue rendered** (a client-supplied "here is what I saw" is an attestation, not a record), and `undoes_decision_id` with `bid_undo_names_its_decision` + a partial unique index so two managers racing cannot take one link back twice. The undo clears a column link filtered on **both** subject id and identity id (so it cannot blank a link somebody else wrote) or **deletes** a key row (that table has no state), and names which in the log. The read throws with its reason — an empty array would claim nobody ever decided — and returns `complete`, false when the page came back full. Page list: `apps/web/src/pages/IdentityDecisionLog.tsx`, mounted OUTSIDE the comparison's data branch, tenant-keyed. **Measured on this tree:** `npx jest --runInBand --forceExit src/vendor-intel` **322 passed / 17 suites**, of which **20 in 1 suite are new here**; `npx vitest run src/pages/IdentityDecisionLog.test.tsx` **8 passed / 1 file**; web `tsc --noEmit` **0 errors**; gateway `tsc --noEmit -p tsconfig.spec.json` **0 errors in vendor-intel** (the only errors on the tree are in another builder's untracked `src/procurement/order-recurrence.*`); `check_route_exposure` PASS *"every route says whether it is authenticated"*, UNDECLARED 0; `check_read_errors_not_swallowed` PASS 191/191 baselined; `check_read_columns_exist`, `check_windowed_figures`, `check_queried_tables_exist`, `check_new_tables_are_locked_down`, `check_fk_targets_exist`, `check_no_seeded_defaults`, `check_adr_numbers_unique`, `check_flag_readby_anchors`, `check_order_capture_contract` all exit 0; `check_gateway_boots.sh` PASS; eslint `--quiet` clean on the touched files; emoji grep empty; migration prefix uniqueness empty. **NOT verified, stated:** still no Docker and no local Postgres, so this migration too was **never applied** — it parses under libpg_query (18 statements + 2 PL/pgSQL bodies) and nothing more, and its append-only trigger is proved only by that block's own text; and the process on `127.0.0.1:4000` still answers 404 to every gateway route, so no live curl was made. Rejected: owner/manager only (the status quo); staff proposes and a manager confirms (the proposals are already generated mechanically, so it would move a button and leave the only judgement furthest from the shelf); a confidence threshold that changes who may decide. |
| 2026-09-05 | Claude (research + build, the identity join) | **Q28 ANSWERED and BUILT.** Founder: *"Do the SOTA and best for scalability thinking there might be more in future."* Twelve standards/vendor/paper sources fetched today (GS1 GMS 1.1 §2.3/§2.8 as a 381,277-byte PDF from `ref.gs1.org` after `www.gs1.org` 403'd twice; LWIN's CC BY 4.0; CellarTracker's three failure modes; Vivino's manual-review sentence; AWS Entity Resolution; SC-Block, Ditto, WDC Products), with **three refusals recorded rather than worked around** — `wine-searcher.com/trade/api` 403, `ttbonline.gov` connection reset, and Liv-ex's own LWIN page no longer publishing the digit structure (recorded from a SECONDARY source and flagged). **The measurement that decided the shape:** the live Iowa file (5,425,785 B, 13,762 rows, `report_as_of` 2026-09-01) carries a check-digit-valid UPC on **100%** of rows and **1,736 of its 9,118 distinct UPCs name more than one product**, 343 of them across different volumes — so the keys table is deliberately not unique on `(namespace, value)` and `joinByExactKey` refuses an ambiguous key at 1/n. **The measurement that killed the obvious alternative:** `master_wine_library.bottle_size_ml` is **750 on all 4,226 rows** (one distinct value, the column default) and only 2 of 3,562 live rows name a format anywhere, so identity cannot live on the library row. **The measurement that is the strongest counter-argument, run through the real code against production:** the fixture register (41 identities) proposes **0 candidates for 608 real beverages**, and `restaurant_inventory` is readable as an identity **0 of 206** times from its own columns but **205 of 206** through its library row. Built: the migration (3 tables + 3 nullable FKs, RLS on, anon/authenticated revoked in-file, an assertion block that **fails if any row is written** and that proves both the generated key and the one-GTIN-two-identities case inside a rolled-back probe), `beverage-identity.ts` (importing the existing normaliser rather than adding a fifth), `identity-join.ts`, `identity.service.ts`, five routes on the existing owner/manager controller, the reader change with `keyedBy`/`groupingNote`, and a dry-by-default backfill script. **Verification on this tree:** `npx jest --runInBand --forceExit src/vendor-intel` → **302 passed / 16 suites**, of which **53 in 3 suites are new here**; `tsc --noEmit -p tsconfig.spec.json` **0 errors**; `eslint --quiet` clean on 8 touched files; emoji grep empty; nine python guards exit 0 and `check_gateway_boots.sh` **PASS**. `check_queried_tables_exist.py` **caught this build** with three `.from(<variable>)` sites in `identity.service.ts` (unresolvable set 26 → 29) — proved pre-existing-clean by exporting HEAD with `git archive` to `$SP/p4aq/head-tree`, where it exits 0; refactored to literal branches, now exits 0 here too. **NOT verified, and stated:** there is no Docker daemon and no local Postgres on this machine, so the migration was **never applied** — it parses under libpg_query (`pglast` 7.18: 39 statements + 1 PL/pgSQL body) and nothing more; and the process on `127.0.0.1:4000` answers **404 to every gateway route including `/auth/me`**, so **no live curl was made**. Five founder questions. |
