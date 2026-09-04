# 0117 — A price sighting names its source, its date and its unit

- **Status:** Proposed — **step 1 of "The order of filling" is BUILT, 2026-09-04.**
  The founder's call the same day: the register's first fill is the house's own
  paper. Both `price_history` writers now mirror into `vendor_price_observations`
  as tenant-scoped class-A rows —
  `apps/api-gateway/src/procurement/own-paper-sighting.ts` (the judgement and
  every refusal, pure) and `procurement.service.ts` `recordOwnPaperSighting`
  (the write), reached from `recordPriceHistory` so both call sites are covered:
  a verified receipt writes `invoice`/tier 1 in the INVOICE's own unit and pack
  (`bottles.units.invoice`, resolved by `toBottleOperands`), a confirmed order
  writes `quote`/tier 2 **only when its resolved pack is exactly one bottle** —
  every other pack, known or unknown, is refused (Q6). Idempotent on the table's existing UNIQUE
  `(source_ref, content_hash)` index, so **no migration was added**. 14 tests in
  `own-paper-sighting.spec.ts`, including the real `priceBelowAverage` run over
  the rows the real writer produces. Steps 2 and 3 (class B/C, class D/E) are
  untouched and still need the migration this ADR calls a precondition.

  **One deliberate divergence, on the founder's instruction of 2026-09-04:**
  `is_outlier` is written **at write time**, not by a batch pass over the group
  as §"The `is_outlier` writer" above specifies. The test itself is unchanged —
  `flagOutliers` (`analytics/engine/vendor-price-consensus.ts:188`), already an
  exported pure function, run over this product's existing sightings plus the
  candidate — and it is still never a bound: no value is clamped or rejected,
  and a flagged row is still written and still visible. The write-time form has
  one property the batch form does not: a sighting is judged only against the
  rows that existed **before** it, so it can never retroactively re-flag its
  own neighbours. It also has one the batch form does not lose: a `MIN_OUTLIER_
  SAMPLE` of 5, because `flagOutliers`' MAD-is-zero branch flags BOTH values of
  a two-row group and `belowTrailingAverage` filters flagged rows out. Whether
  the batch pass should replace or supplement this is the founder's call
  (Q6 below).

  **Q4 is answered by research, not yet decided, 2026-09-04.** The founder's call the
  same day — *"research their markets separately"* — was carried out; the result is
  the dated section **"Türkiye and the United Kingdom, 2026-09-04"** in
  `.planning/07-reference/price-sources.md`. Headline: **neither market has a class B
  and neither can have one.** Class B exists in the US because three-tier licensing
  compels a wholesaler to publish; Türkiye instead *bans* alcohol price advertising and
  online sale (Law 4250 md. 6; sales regulation md. 11 — both reached only through
  secondary commentary today, since `mevzuat.gov.tr` failed DNS and
  `resmigazete.gov.tr` failed TLS, so the statutory claim is recorded as unverified),
  and the UK simply has no posting regime — every trade portal measured (Matthew
  Clark/MCB, LWC, Bidfood, Brakes, Booker, Venus) prices per account. What both states
  publish is **the tax**: the GİB ÖTV (III)(A) schedule, read in full today (beer
  12,4849 TL · still wine 61,3914 TL · rakı 1.705,9025 TL · spirits 1.919,1384 TL,
  **unit not stated on the table and not asserted**), and HMRC's duty rates in force
  1 February 2026 (£22.58 / £26.61 / £30.62 / £33.99 per litre of pure alcohol, OGL
  v3.0). Neither is a price. Five new founder questions, Q8–Q12, are recorded in the
  registry rather than copied here.

  **A defect this research found, and it lands only on these three houses.**
  `price_history` has **no currency column** (`…20260805000000_baseline_from_
  production.sql:4274`), neither call site passes one (`procurement.service.ts:3221`,
  `:4764`), and `own-paper-sighting.ts:276` reads
  `const currency = (input.currency ?? "USD").toUpperCase()`. **So every class-A
  sighting the two Türkiye houses and the UK house produce is stamped USD**, and the
  mixed-currency guard (`price-below-average.ts:187-192`) cannot see it because the
  group agrees — on the wrong currency. `public.restaurants.currency` already exists
  (`…:3576`), so the fix needs **no migration**: pass the tenant's currency at both
  call sites and **refuse** when it is absent, exactly as the writer already refuses an
  absent `observedAt`. Whether those three tenant rows actually hold `TRY`/`GBP` rather
  than the `'USD'` column default is **unmeasured** (Q10).

  **Q5 update, 2026-09-04:** the founder is **requesting a Wine-Searcher trade API
  quote himself**. If bought it is a **class-D retail reference only** — its own
  register, labelled retail, never beside a vendor quote. **The cost stays unmeasured
  until the quote arrives**; the pricing page returned 403 to this environment.

  **Steps 2 and 3 of "The order of filling" are BUILT, 2026-09-04** — the founder's
  call the same day: *"start them already, not from the bottom but from the top, full
  coverage applicable"* and *"show control-state shelf prices as a labelled index line
  in their own register, state-scoped."* The migration this ADR named a precondition
  now exists — `supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`,
  a NEW table `price_index_postings` keyed by **state, not restaurant** (the three
  blockers `scripts/fetch_price_sightings.py` refused `--apply` over are cleared: it has
  `source_class`, `issuer`, `state`, `issued_at` and `price_basis` columns, and it is not
  restaurant-scoped so it can never enter the market box's `restaurant_id.is.null` read).
  Applied to a live local Postgres: RLS on, anon/authenticated `NONE`, the
  `(source_ref, content_hash)` uniqueness present, the in-file assertion NOTICE fired.
  The parsers live in the gateway (`apps/api-gateway/src/price-index/`), one truth per
  source so the scheduled fetch and the endpoint share it — **California is LIVE** (class
  B beer posting, fetched today through the app's own anonymous JWT path, 8 of 13 fixture
  rows admitted, 4 superseded + 1 duplicate refused and counted), **Iowa and Oregon** are
  the control-state shelf lines (class D, ported from the Python proof against the same
  fixtures), and **Michigan is WITHHELD** — recorded unverified with the reason
  (`michigan.gov` returns 403 to a polite fetcher, robots.txt also 403, the price book is
  Excel/PDF), its parser deliberately not written because no honest sample exists. A
  scheduled fetch (`price-index-fetch.service.ts`) runs per source at its cadence,
  **defaults OFF** behind `PRICE_INDEX_FETCH_ENABLED` (allow-list), with the staleness
  gate standing before every write; `GET /price-index/:state?product=` returns the
  labelled index line for a house's own state, `GET /price-index/status` says per source
  when it last fetched, how many rows, and why it is silent. 40 tests. See the new section
  **"The index register, built"** below.

  **Q1 is ANSWERED and step "class D-adjacent" is BUILT, 2026-09-04.** The founder,
  asked §Founder-only questions Q1 ("run the existing vendor sweep?"), said: *"Run
  it, labelled tier 4, never beside a quote."* Both halves are built on
  `feat/mudavym-design-p4`:

  * **Run it.** `apps/api-gateway/src/vendor-intel/vendor-site-sweep.service.ts` —
    a daily cron (`20 4 * * *`) over every active `providers` row with a website,
    **per restaurant**, **OFF by default** behind `VENDOR_SITE_SWEEP_ENABLED` (the
    reason for the default is in `isSweepArmed`, `vendor-site-sweep.ts`). robots.txt
    is honoured as before, and its `Crawl-delay` is now READ — `parseCrawlDelay`,
    added to `vendor-page-extraction.ts`, because nothing in this repo parsed the
    directive this ADR calls binding. Pacing is per host at a **10-second floor**
    (`DEFAULT_HOST_INTERVAL_SECONDS`, reasoned in the constant's docblock), raised
    to the host's own `Crawl-delay` whenever that is larger, never lowered below 2.
    One vendor's failure is that vendor's status row and never the sweep's end.
  * **Labelled tier 4.** `vendor-site-sighting.ts` writes `source_type
    'website_scrape'` / `trust_tier 4` — both already admitted by
    `vpo_source_type_check` and `vpo_trust_tier_check`
    (`20260805154027_vendor_price_observations.sql:112-118`), **re-read, so again
    no migration**. `source_ref` is the page URL plus the product, `source_url` the
    page, plus the content hash. `observed_at` is **the page's own date when the
    page states one** (`readPageStatedDate`, which requires an explicit label so a
    vintage or a copyright year is never mistaken for provenance) and otherwise the
    fetch time carrying `raw.undated = true` and `raw.dateBasis =
    'fetch_time_undated'`; `effective_date` stays NULL unless the vendor claimed
    one. `is_outlier` is the **same** `isOutlierAgainstPriors` at the **same**
    `MIN_OUTLIER_SAMPLE` of 5, imported from `procurement/own-paper-sighting.ts`
    and re-exported rather than forked. This closes the scrape half of the gap
    `notifications.md` §13.25(b) named as the one that matters most.
  * **Never beside a quote.** `comparisonClassOf` (`price-below-average.ts`)
    partitions every product's sightings by class before the comparison:
    `quoted` (invoice, quote, api_catalog, chat, social, manual) and `public_site`
    (website_scrape), with an unrecognised `source_type` given a class of its own
    rather than folded into the quotes. `items` carries only `quoted`;
    `publicSiteItems` is the tier-4 line, its own. **Measured against a copy of
    HEAD's file:** the pre-fix function ranked a $50 `website_scrape` as a **50%
    saving** against a $100 invoice average; the same four rows now produce zero
    items and `scanned.comparisons` 2 against `scanned.products` 1.
  * Every refusal is counted by reason and surfaced per vendor at **`GET
    /vendor-intel/site-sweep/status`**, together with why a vendor is silent
    (disarmed / not yet swept / no website / robots forbids / fetch failed /
    nothing priced / all refused) — six facts that would otherwise all render as
    an empty register.

  **What this does NOT do.** The refusal legs are the same as class A's, and on a
  scrape the missing-bottle-volume leg is the common case rather than the corner
  case: most shop pages do not print a size next to the price, and every such row
  is refused rather than assumed to be 750ml. Expect the first real sweep to refuse
  most of what it reads. That is the intended behaviour and the count says so.
  Nothing about §Context 5 changes either: a monthly-ish page yields too few
  sightings per 30-day window to light the market box on its own.

  **Dry run, 2026-09-04, one real vendor site, robots honoured.** `www.wine.com`
  served `robots.txt` (6,038 bytes) to the identifying UA: **no `Crawl-delay` for
  any agent**, `/search` disallowed (so there is no permitted way to enumerate a
  catalogue), `/` and `/product/*` allowed. The allowed homepage then returned
  **HTTP 403** with a DataDome captcha body (768 bytes). `www.klwines.com` returned
  **403 to the `robots.txt` request itself** behind a Cloudflare challenge. Under
  this build both are `fetch_failed`, recorded per vendor as unverified — a fact
  about our fetcher, not about the vendors' prices. Two of two real merchant sites
  tried refused this environment at the page.
- **Date:** 2026-09-04
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** price sightings, vendor_price_observations, price register, market price, posted wholesale list, public index, provenance, is_outlier, Iowa, Oregon, OLCC, USDA, robots.txt, rate limit, attribution, Türkiye, ÖTV, GİB, TADB, hal.gov.tr, United Kingdom, HMRC alcohol duty, ONS, Defra, AHDB, WSTA, Liv-ex, currency default
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
6. **The agreed price's unit is not stated anywhere, so the mirror takes only
   the single-bottle case.** Added 2026-09-04 while building step 1.
   `price_history` hardcodes `unit: 'BOTTLE'` and its docblock
   (`procurement.service.ts:925`) records that all three callers pass a per-bottle
   figure — but nothing on `procurement_orders` states the unit of `final_price`
   separately from the order's own `unit_type`. On an order placed in cases the
   two readings differ by the pack size, and a case price filed as a bottle price
   makes a whole ladder wrong.

   **Stated exactly, because the earlier wording oversold it:** the mirror writes
   an `order_confirmed` sighting **only when the order's resolved pack is exactly
   one bottle**, and refuses every other case with a logged sentence. That is a
   wider refusal than "an unstated unit" — it refuses a **known** pack of 12 just
   as firmly as an unreadable one, because knowing the pack does not tell us
   which unit the PRICE is in. It also refuses an order whose `unit_type` is
   present but not `bottle` and whose line carries no `bottles_per_unit`. The
   receipt path has no such gap: the invoice states its own unit, and
   `toBottleOperands` has already resolved and refused it.

   Options: state a unit on the agreed price, treat `final_price` as per-bottle
   by decree, or leave case-priced agreements out of the register permanently.
   Not guessed at.

   **Researched in full, 2026-09-04 — see
   `[[0119-an-agreed-price-states-its-unit]]` (Proposed).** The founder asked for
   every angle, so Q6 now has its own ADR rather than an answer inline here. It
   maps six options across five cost surfaces (migrations · readers · the
   receiving door · this register · ADR 0070's `uom` rule), and three of its
   findings bear directly on this ADR: (a) the sibling register
   `price_index_postings` — shipped the same day for classes B/D/E — **already**
   requires `price_unit NOT NULL` ("per package" / "per bottle" / "per case",
   `20260904200000_a_posted_price_names_its_state.sql:96`), so class A is now the
   only class whose price may be filed without a stated unit; (b) the
   no-migration option, *derive the bottle price from the case price and the
   pack*, is refuted by the trade itself — Connecticut defines the posted bottle
   price as case ÷ pack **plus 2–8¢ by bottle size**
   (<https://www.cga.ct.gov/2004/rpt/2004-R-0593.htm>), and New York lets a
   discount attach to one unit and not the other
   (<https://sla.ny.gov/price-posting>); (c) the recommendation is the shape ADR
   0070 already chose for stock — a figure beside the unit it is stated in — put
   on `procurement_order_items` where the pack already lives. Q6 stays **open**;
   0119 carries seven founder-only questions of its own, including whether
   `price_history.unit` stops being hardcoded.
7. **Should the batch outlier pass still be built** alongside the write-time one
   (see the Status note)? A batch pass can re-judge a row after later evidence
   arrives; the write-time writer cannot.

## The index register, built (2026-09-04)

This is the concrete shape of steps 2 and 3. Classes D and E were always going to be
their own line (ADR 0111); this section records how B, D and E share one register and
never touch the market box's average.

### The table

`price_index_postings` (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`).
It carries the founder's column list — `state, issuer, issued_at, fetched_at`, the product
identity as posted, `price, price_unit, pack, source_ref, content_hash` — plus the three
columns that were the whole reason a new table was needed: `source_class` (B/D/E, a CHECK
that admits no other value), `price_basis` (which published number this is — the CA trade
level, Iowa's `state_bottle_retail`), and `region` (a CA county). **Unique on
`(source_ref, content_hash)`**, so a re-read of an unchanged posting dedups and a price
change is a new row. **RLS on, `service_role` only, anon/authenticated revoked in the same
migration**, with an in-file `DO` block that asserts every one of those and the column
contract — proven on a live local Postgres (grants `NONE`, `relrowsecurity` true, the
assertion NOTICE fired). It has **no `restaurant_id`**: the register is public and keyed
by state, and the endpoint scopes it to a house's state at READ time. That is what keeps
an Iowa shelf price out of a California house's market box — the comparison this ADR's
`--apply` refusal named.

### The parsers, and the coverage decision

The parsers live in the gateway (`apps/api-gateway/src/price-index/`), not in a second
Python script, so the scheduled fetch and the read endpoint share exactly one definition
of "what this posted row means" — the same anti-drift rule `fetch_price_sightings.py`
applies to `REFERENCE_VOLUME_ML`. The Python proof stays as the independent full-file
measurement; the TS parsers are tested against the SAME recorded fixtures so the two
cannot silently disagree.

Coverage was read from the `restaurants` table, not guessed (14 houses: 3 Michigan,
3 California, 3 Illinois, 2 Türkiye, 1 UK, 2 stateless). Of the tenant states, only
**Michigan and California** post a list.

- **California — LIVE (class B).** The public beer price posting is served by a SPA whose
  "public" AppSync endpoint is authorised by a JWT the app signs IN THE BROWSER with a
  secret shipped in its own bundle. Reproducing that (`fetchers.ts::californiaBearer`,
  secret read from `PRICE_INDEX_CA_JWT_SECRET`, never committed) is the anonymous path a
  member of the public uses — no login, no scrape. Fetched today for Santa Clara county
  (where the CA houses sit): real rows, admitted only when `status = 'Active'`, the trade
  level kept as `price_basis`, beer NOT normalised to a 750ml bottle.
- **Iowa and Oregon — the control-state shelf lines (class D).** Ported from the Python
  proof. These are the founder's "control-state shelf prices as a labelled index line,
  state-scoped": no tenant sits in either state yet, but the endpoint can serve US-IA /
  US-OR the moment one does, and the register has a tested implementation for it.
- **Michigan — WITHHELD.** `michigan.gov` returns 403 to a polite anonymous fetcher
  (Akamai edge block) on both the price-book page and a direct PDF; its robots.txt is also
  403; the book is Excel/PDF, not a machine endpoint. Recorded unverified in the registry;
  **its parser is deliberately not written, because there is no honest sample to write it
  against.** A parser written against an invented Michigan row would be the exact fault
  this ADR exists to prevent.

### The scheduled fetch and the endpoint

`price-index-fetch.service.ts` runs per source at its cadence and **defaults OFF** behind
`PRICE_INDEX_FETCH_ENABLED` (allow-list — a typo leaves it silent, never a live crawler
on). It is the one process here that makes outbound government requests in the house's
name. The staleness gate (`staleness.ts`, the TS twin of the Python one) stands before
every write: a run whose newest issuer date exceeds the source's cadence is refused whole
— the measured `bh_fv020.txt` case. Every run's outcome (counts, refusals by reason, why
it was silent) is kept for `GET /price-index/status`. `GET /price-index/:state?product=`
returns the labelled index line(s) for one state, owner/manager-guarded like vendor-intel,
each line carrying its class, issuer and date so the caller draws it as its OWN line and
never beside a vendor quote.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-04 | Claude (research) | Created. Sources fetched and measured the same day; the leading candidate attacked and demoted from class B to class D before being recorded. Registry: `.planning/07-reference/price-sources.md`. Proof: `scripts/fetch_price_sightings.py` |
| 2026-09-04 | Claude (build, index register) | Steps 2+3 BUILT on `feat/mudavym-design-p4`: `price_index_postings` migration (applied to a live local PG — RLS on, anon/authenticated NONE, uniqueness present, assertion NOTICE fired, idempotent), the gateway `price-index/` module (California LIVE via the app's anonymous JWT path; Iowa/Oregon class-D shelf lines; Michigan WITHHELD with the 403 evidence and no fabricated parser), a fetch job defaulting OFF behind `PRICE_INDEX_FETCH_ENABLED` with the staleness gate, and `GET /price-index/:state` + `/status`. 40 tests pass, gateway tsc + eslint clean on the module. Fixtures recorded in `.planning/07-reference/price-sources.md` and the module's `__fixtures__/`. |
| 2026-09-04 | Claude (build, sweep) | Q1 answered by the founder and BUILT: the scheduled vendor-site sweep (OFF by default), tier-4 labelling with the undated flag and the shared outlier test, and the class gate that keeps a tier-4 row out of `items`. 30 new tests in `vendor-intel` (136 in the directory, all green); the gate proven against a copy of HEAD, where the same rows produced a fabricated 50% saving. Dry run against `www.wine.com` and `www.klwines.com`: robots honoured, both 403 at the page. The gateway on :4000 was DOWN for this session, so nothing was curl-verified. |
| 2026-09-04 | Claude (build) | Step 1 BUILT on `feat/mudavym-design-p4`: `own-paper-sighting.ts` + `recordOwnPaperSighting`, both `price_history` call sites mirrored, idempotent on the existing `(source_ref, content_hash)` index, `is_outlier` written by `flagOutliers` at write time (founder's instruction; the divergence from this ADR's own batch-pass wording is recorded in the Status). 14 tests pass; `GET /vendor-intel/below-average` still 200 with `scanned.observations` 0 locally, the register being empty in this environment. Two new founder questions (Q6, Q7). |
| 2026-09-04 | Claude (market research, TR + UK) | **Q4 researched, not decided.** ~65 fetch attempts recorded in `.planning/07-reference/price-sources.md` §"Türkiye and the United Kingdom, 2026-09-04". Verified: GİB ÖTV (III)(A) PDF, HMRC duty rates, hal.gov.tr HKS (daily, TL/kg, live today), Defra wholesale fruit and veg CSV, ONS `d7bv` JSON, TÜİK/Metro/Bizim Toptan robots.txt, five Turkish producers, five UK trade portals, WSTA, Liv-ex, AHDB terms. Unverified and named as such: resmigazete.gov.tr and mevzuat.gov.tr (TLS/DNS), TCMB EVDS, İBB Swagger, Booker, Brakes, Venus, all three UK grocers' robots.txt. Found the class-A USD-default defect above. Q5 updated (quote requested); Q8–Q12 filed in the registry. No code changed. |
