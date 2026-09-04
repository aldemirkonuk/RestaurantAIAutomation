# 0117 — A price sighting names its source, its date and its unit

- **Status:** Proposed
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** price sightings, vendor_price_observations, price register, market price, posted wholesale list, public index, provenance, is_outlier, Iowa, Oregon, OLCC, USDA, robots.txt, rate limit, attribution
- **Links:** `[[0111-the-calendar-is-the-houses-day-book]]` (the separate-register rule), `[[0114-connections-are-the-houses-profile-is-the-persons]]` (where a licensed feed is declared), `[[0020-no-fabricated-answers]]` and `[[0051-rebuilt-pages-show-live-data-only]]` (the absence-reported-as-health rule), `[[0108-a-register-is-the-houses-own-books-first]]`, `[[0115-the-house-item-is-the-ledgers-key]]`, `.planning/07-reference/price-sources.md`, `scripts/fetch_price_sightings.py`

## Context

The founder, asked which register to fill first, said: *"research, find vendors who can
provide them or websites who are free to fetch data, make sure they are verifiable and
works perfectly, rate limiting is fine for now."*

The register in question is `vendor_price_observations`
(`supabase/migrations/20260805154027_vendor_price_observations.sql:50`). It is well built
— seven trust tiers, an immutable-observation shape, a normalisation column, a scrape
dedup index — and **measured on production 2026-09-04 it holds 0 rows.** So do
`price_history` (0), `procurement_documents` (0) and `procurement_document_lines` (0).
Everything downstream is therefore silent by construction: the market box on
`/notifications` (`useMarketPrice.ts` → `GET /vendor-intel/below-average`), the market
producer (`market-price.producer.ts:312`), the calendar's price mark (ADR 0111), and the
`quote` line on every beverage register (`beverages.service.ts:904`).

Five things measured today changed the shape of this decision.

**1. The house's own paper does not reach this register.** `price_history` finally has a
writer — `procurement.service.ts:900`, called from order confirmation
(`:4393`) and from receipt verification (`:2902`) — and `check_order_capture_contract.py`
guards that it keeps one. But it writes to `price_history`, a **different table**, and
nothing anywhere writes an `invoice`-tier row into `vendor_price_observations`. Re-grepped
2026-09-04, that table has **exactly two writers** — the website scrape
(`vendor-page-extractor.service.ts:331`, `.upsert`) and the manual observation a person
types in (`vendor-comparison.service.ts:260`, `.insert`) — and **four readers** in four
files (`vendor-comparison.service.ts:122,335`, `beverages.service.ts:907`,
`market-price.producer.ts:312`). **This corrects `vendor-prices.md:97`**, which says
*"only three files write `vendor_price_observations` in the whole repo"*: two of those
three were the writers above, and the two readers on the beverage registers and the market
producer have been added since. The best-provenanced price the house will ever have — a
verified invoice line, trust tier 1 — is being written where none of those four readers
can see it.

**2. The house's largest body of prices cannot be admitted.** `master_wine_library` holds
4,226 rows, **3,674 of them carrying a `price_reference`**. 3,474 of those come from
`source = 'menu_corpus'` — they are **restaurant menu list prices**, what a diner pays for
a glass, and the table has **no date column and no issuer column** for them
(`retail_price_avg` exists and is NULL on all 4,226). `PRODUCER_REPUTATION_PLAN.md:31`
already constrains it: *"`price_reference` is a market hint, never a restaurant's price."*

**3. The best free source in the world returns 200 forever.** On 2026-09-04
`https://www.ams.usda.gov/mnreports/bh_fv020.txt` returned **HTTP 200** carrying a Boston
terminal-market report headed *"BOSTON Terminal Prices as of 03-JAN-2024"* — 975 days
stale — announcing its own migration only in prose inside the body. A fetcher that read
the status code as freshness would have written January-2024 produce prices as today's
sightings, and nothing anywhere would have raised an error. This is the
absence-reported-as-health fault arriving through the front door.

**4. The state matters, and the register has no column for it.** Production holds 14
restaurants: **3 in Michigan, 3 in Illinois, 3 in California, 2 in Türkiye, 1 in the
United Kingdom, 2 with no state at all** (and the column is free text — both `MI` and
`Michigan`, and `United States` / `united States` / `USA` / `US`). Of those, only
Michigan (a control state, Excel + PDF price book) and California (beer price posting,
public since 2023-10-15) have a posted list; Illinois has none; Türkiye and the UK are
outside every source class in this ADR. **The two best machine-readable sources found
today — Iowa and Oregon — cover zero tenants.**

**5. Filling the register does not light the box.** `MARKET_WINDOW_DAYS = 30` and
`MIN_BASELINE_OBSERVATIONS = 3` (`market-signal.ts:84,87`), and `minObservations` counts
the **earlier** sightings (`price-below-average.ts:118,199`), so a product needs **four
sightings inside thirty days**. The scrape dedup index
(`…vendor_price_observations.sql:141`) correctly discards a re-read of an unchanged price.
A **monthly** posted list therefore yields at most **one** sighting per product per
window, and can never reach four. Loading 13,762 Iowa rows would leave the market box
exactly as silent as it is now — while making the register look full.

## Options considered

1. **Scrape the vendors we already have.** `sweepCatalogue`
   (`vendor-page-extractor.service.ts:349`) exists, is polite (robots.txt at `:87`, 2s
   between hosts at `:377`, an identifying UA at `:25`), writes tier-4 `website_scrape`
   rows, and **has never been run**: production holds **23 active vendors with a website**
   and 0 observations. Cheapest by far. Costs: tier 4 is the second-least-trusted tier; a
   distributor's public site rarely carries licensee pricing; and it is a per-site parse
   that breaks on markup changes.
2. **Write the house's own paper into the register.** Mirror every `price_history` write
   as a tier-1 `invoice` observation. Best provenance obtainable, no fetch, no terms, no
   rate limit. Costs: it produces nothing until the house actually receives invoices, and
   today `price_history` is at 0.
3. **Load a state's posted wholesale list.** Machine-readable, dated, attributable, free.
   Costs: the whole of §Context 4 and 5 — wrong state, wrong cadence, and a `source_type`
   the table cannot express.
4. **Buy a reference feed** (Wine-Searcher trade API; a licensed distributor connection).
   Broadest coverage. Costs: money, a licensee login the house does not have, and — for
   the retail feeds — a number that is not a wholesale price at all.
5. **Do nothing.** The register stays at 0, the market box keeps saying so honestly, and
   the calendar's price mark stays dashed. Costs: a promised capability stays dark
   indefinitely, and the founder asked for the opposite.

## Decision

**A row may enter the price register only if it names, on the row, five things: what
number it is, who published it, when they published it, what unit it is in, and where it
is a price. Anything missing one of the five is not a sighting and is refused, not
defaulted. And a sighting may only ever be compared to another sighting of its own
class.**

### The five source classes, and what each may be compared to

| Class | What it is | May be compared to | May NEVER be |
|---|---|---|---|
| **A. Own paper** | A verified invoice or a confirmed order — the house's own `price_history` rows, mirrored in as `invoice`/`quote`, tiers 1–2 | This house's own history; a posted wholesale list **in this house's own state** | Pooled across tenants |
| **B. Posted wholesale list** | A price a state requires a supplier or wholesaler to publish (NY SLA, CA ABC beer, CT DCP, MI LCC licensee price) | Class A **for a house in that same state** | Shown to a house in another state |
| **C. Licensed distributor feed** | A price behind the house's own licensee login (Provi, SGWS Proof, eRNDC, LibDib) — declared as a connection under ADR 0114 | Class A and B for that house | Read without that house's credentials |
| **D. Retail reference** | Wine-Searcher, Vivino, Total Wine, a control state's **shelf** price (OLCC, Iowa `state_bottle_retail`) | Only other class-D lines | Placed beside a vendor quote |
| **E. Public index** | USDA Market News, BLS PPI, USDA ERS | Only other class-E lines | Called a price for a named product |

Classes D and E render as **their own line, in their own register**, per the founder's
call recorded in ADR 0111. This ADR adds the reason: an Oregon shelf price and an Iowa
`state_bottle_retail` are **class D, not class B** — they are what a consumer or an
off-premise licensee pays a state store, with that state's statutory markup baked in
(Iowa's median `state_bottle_retail / state_bottle_cost` is **exactly 1.50** across
13,762 rows).

### The provenance a sighting must carry

`source · issuer · issuer_jurisdiction · issued_at · fetched_at · price_basis · unit ·
pack · currency`. Measured against the table today, **three of the nine have nowhere to
go**:

| Required | Column today | Verdict |
|---|---|---|
| source | `source_type`, `source_ref`, `source_url` | present — but see the CHECK below |
| issuer | — | **missing.** `vendor_name_raw` is the vendor, not the publisher |
| issuer_jurisdiction | — | **missing.** No state/country column anywhere on the row |
| issued_at | `effective_date` (bare `date`) | **wrong shape.** It means the vendor's effective date, not the file's issuance |
| fetched_at | `observed_at` | present |
| price_basis | — | **missing.** Iowa publishes three prices per row; nothing records which one was taken |
| unit | `unit_volume_ml` | present for bottles, **absent for food** — there is no weight or count unit, and `normalizeUnitPrice` scales only by ml (`vendor-price-consensus.ts:115`) |
| pack | `pack_size` | present |
| currency | `currency` | present |

And `vpo_source_type_check` (`…vendor_price_observations.sql:112-115`) admits only
`invoice · quote · api_catalog · website_scrape · chat · social · manual`. **There is no
value meaning "a government's posted list".** `api_catalog` is documented as *"vendor's
own structured feed"* and a state posting is not one; writing under that label puts a
falsehood into the column the entire consensus weighting rests on. A migration is
therefore a **precondition** of class B/D/E ever being written, not a follow-up.

### The `is_outlier` writer

`is_outlier` is `DEFAULT false NOT NULL` and **has no writer anywhere**
(`notifications.md` §13.25(b)); `belowTrailingAverage` filters `.eq("is_outlier", false)`
(`vendor-comparison.service.ts:340`), so today every row — including a catastrophic parse
— is admitted as clean. The writer is the MAD test the engine already implements
(`flagOutliers`, `vendor-price-consensus.ts:188`, threshold 3.5 robust deviations, with
the MAD-is-zero branch), **run over the group after a batch lands, never at write time and
never as a bound on the incoming value.** The column's own comment already says this
(*"Set by the consensus pass, not at write time — outlier-ness is a property of the group,
not of the row"*); this ADR makes it a job rather than a comment. A row is never rejected
for being an outlier — it is flagged, and it stays visible in the ladder so a bad parse is
fixable at source.

### The order of filling

1. **Class A, both halves.** Mirror the two `price_history` writers into
   `vendor_price_observations` as tier-1/2 rows scoped to the restaurant. No fetch, no
   terms, no rate limit, best provenance in the system. Blocked on nothing but the work.
2. **Class B/C in the tenant's own state**, starting with the three Michigan houses
   (licensee price, published) and the three California houses (beer postings, public
   since 2023-10-15) — and only after the migration above, because neither can be written
   honestly today.
3. **Class D/E as their own register**, which is where Iowa and Oregon go. Never in the
   market box.

**Explicitly NOT decided here:** whether to run the existing `sweepCatalogue` against the
23 active vendors that have a website. It would put rows in the register tomorrow at tier
4, and it is the founder's call whether a public-site scrape is a price this house wants
to be told about (§Founder-only questions, Q1).

### Terms, rate limits and attribution

Binding on any fetcher this repo ships:

- **robots.txt is honoured**, and the crawl delay in it is the floor. `data.oregon.gov`
  sets `Crawl-delay: 1` for `User-agent: *` and does not disallow `/resource/`
  (fetched 2026-09-04).
- **The stated API limit is honoured.** Socrata throttles unauthenticated requests per-IP
  from a shared pool and answers 429; a free app token raises it to 1,000 requests per
  rolling hour. BLS's keyless v1 tier is 25 queries/day, 25 series, 10 years, 50
  requests/10s. USDA MARS requires a key — `https://marsapi.ams.usda.gov/services/v1.2/reports`
  returned **403** to an unauthenticated request on 2026-09-04.
- **Attribution travels on the row.** Iowa's dataset is **CC BY 4.0**, so every derived
  sighting carries the attribution string. Oregon declares an attribution
  (*"Oregon Liquor & Cannabis Commission"*) and **no licence at all** — unstated terms are
  recorded as unstated, never as permissive.
- **An identifying User-Agent** with a contact URL, so a publisher can block us
  deliberately rather than by accident — the existing extractor's practice
  (`vendor-page-extractor.service.ts:25`).
- **A source we could not fetch is recorded as unverified, never as unavailable.**
  `michigan.gov`, `data.iowa.gov`, `biznet.ct.gov` and `priceposting.abc.ca.gov` all
  refused this environment's fetcher today (403 / WAF rejection / TLS chain). That is a
  fact about our fetcher, not about the source.

### The staleness gate

Every fetch compares the **issuer's own date** against today and refuses the whole run
when it exceeds the source's cadence. This is not defensive polish: it is the only thing
standing between the register and the measured `bh_fv020.txt` case, where a live 200
served a 975-day-old price list. Implemented and proven in
`scripts/fetch_price_sightings.py --self-test`.

## Consequences

**Easier.** The market box's silence becomes a plan rather than a state: the first fill is
the house's own invoices, which need no vendor, no terms and no network. Every sighting
becomes readable — a person can see which published number was taken, by whom, on what
date, in what unit, for which state. `is_outlier` stops being a column that certifies
every row as clean.

**Harder / given up.** Nothing outside class A can be written until a migration adds the
source type, the issuer, the jurisdiction and the price basis — so "fill the register
this week" is off the table. The 3,674 `price_reference` values stay out, permanently
under this rule, because they carry no date and no issuer. Class D and E never enter the
market box, so the register will look thin for a long time next to what is technically
fetchable.

**What would trigger revisiting.** (a) The market producer staying silent after class A is
mirrored — that would mean the 30-day / 3-earlier-sighting bar, not the register, is the
constraint. (b) A tenant appearing in New York or Oregon, where a real class-B feed
exists. (c) Any tenant outside the US and Türkiye growing past one house — none of these
five classes has a source for it.

## What was tried against this decision, and survived

The leading candidate was **Iowa Liquor Products as the first fill**: 13,762 rows,
keyless, CC BY 4.0, `report_as_of` stamped `2026-09-01` on every row, 100% coverage of
price, volume, pack and UPC, fetched and parsed today. It was attacked deliberately and
**lost as a vendor quote on six counts**, every one measured:

1. **No wine, no beer.** All 48 categories are distilled spirits. It prices nothing in the
   house's largest register.
2. **Wrong price.** `state_bottle_cost` is what Iowa pays the supplier; `state_bottle_retail`
   is that × **1.50** at the median. Neither is a price a restaurant is quoted.
3. **Wrong party.** `vendor_name` is the *producer* (SAZERAC COMPANY INC), not a
   distributor anyone can buy from.
4. **Wrong state.** Zero of 14 tenants are in Iowa.
5. **Wrong tenancy.** Written with `restaurant_id NULL` it would surface in **every**
   house's market box, because `belowTrailingAverage` reads
   `restaurant_id.is.null OR restaurant_id.eq.<tenant>` (`vendor-comparison.service.ts:341`).
6. **Wrong cadence.** One sighting per product per month against a bar of four per thirty
   days: the register fills and the box stays silent.

It survives as a **class-E/D index**, which is exactly where ADR 0111 put public indexes —
arrived at here independently, from the data rather than from the rule.

The parser was then run over the full 13,762 rows and found the source's *own* defects:
**29 rows where `state_bottle_cost × pack` disagrees with `state_case_cost`** (item
`920301` publishes a $1,250 bottle cost against a $240 case cost for a pack of 6 — a
$60 bottle), **11 rows with `bottle_volume_ml = 0`** (all of them bulk "Ingredient"
listings whose pack is also wrong), and **2,308 duplicate item numbers** published under
more than one category. A parser that trusted the file would have written a $1,250 bottle
and a zero-millilitre one. That is why the consistency cross-check is part of the decision
and not an implementation detail.

## Founder-only questions

1. **Run the existing vendor sweep?** `sweepCatalogue` would put tier-4 `website_scrape`
   rows in the register against **23 active vendors with a website**, tomorrow, with no new
   code. Is a public-site price something you want the house to be told about, or is tier 4
   too weak to be worth the noise?
2. **Is a control-state shelf price allowed to be *shown* at all**, clearly labelled as a
   separate index line — or does it stay out of the product entirely until a real
   class-B/C feed exists?
3. **Michigan and California first?** Six of fourteen houses sit in the only two tenant
   states with a posted list. Neither is machine-readable without work (Michigan is Excel
   and PDF; California is a per-county web search). Is that the next build, or does class A
   have to prove itself first?
4. **The two Türkiye houses and the UK house have no source in any of the five classes.**
   Is a permanent em dash for them acceptable, or does that change the class list?
5. **Pay for anything?** Wine-Searcher's trade API is the only broad wine-price source
   found; its pricing page refused this environment (403) so the cost is unmeasured. Worth
   a quote request?

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | Claude (research) | Created. Sources fetched and measured the same day; the leading candidate attacked and demoted from class B to class D before being recorded. Registry: `.planning/07-reference/price-sources.md`. Proof: `scripts/fetch_price_sightings.py` |
