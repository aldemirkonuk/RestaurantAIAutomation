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
    page, plus the content hash. **`observed_at` is when WE saw it — our fetch
    clock, always** — and the page's own claimed date, when it makes one, goes to
    **`effective_date`** (`readPageStatedDate`, which requires an explicit label so
    a vintage or a copyright year is never mistaken for provenance). A page that
    claims no date carries `raw.undated = true`, `raw.dateBasis =
    'fetch_time_undated'` and a NULL `effective_date`; both dates are on every row
    either way (`raw.fetchedAt`, `raw.pageStatedDate`). **This is a correction to
    this build's first cut**, which put the claimed date into `observed_at`: the
    comparison windows on `observed_at`, so a page claiming "prices effective 1
    July" would have dropped a sighting read TODAY out of a 30-day window, and a
    forward claim would have held a stale price inside one. The window must be a
    fact about our reading, which we control and can audit, never a claim printed
    on a page we do not control — which is also what the column's own comment
    (`…vendor_price_observations.sql:75-78`) and this ADR's own provenance table
    (`fetched_at -> observed_at`, `issued_at -> effective_date`) already said.
    `is_outlier` is the **same** `isOutlierAgainstPriors` at the **same**
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

**Class E's register is BUILT, and its plan is elsewhere (2026-09-05).** Phase 0 of
[`commodity-signals-plan.md`](../07-reference/commodity-signals-plan.md) shipped on the
founder's *"both: the line now, the alert behind a flag"*: migration
`20260905235000_an_index_series_is_not_a_price.sql` (three tables, RLS on, anon/authenticated
revoked, five CHECKs probed in-file, PGlite-proven), `apps/api-gateway/src/commodity/`,
`GET /commodity-index/me`, and a context line inside the same labelled box on
`/notifications`. **Two series are armed for fetching and one is registered and never
fetched**: FAO Food Price Index and ONS `d7bu` (both robots-read first, logged), and the USDA
AMS shell-egg index carrying `www.ams.usda.gov`'s HTTP 403 as its withheld reason. **Q27's
`issued_at_basis` earned its keep immediately and on measurement rather than on principle:**
the FAO CSV states no date of any kind, so it is `fetch_date` and prints "read on", while ONS
stamps one on every observation and prints "issued". **Class E now holds RATES as well (2026-09-05, the founder's batch-51 answer to
the plan's Q6).** `value_kind: 'rate'` has three occupants — HMRC alcohol duty
(OGL v3.0, per litre of pure alcohol, in force 2026-02-01), the Illinois liquor
gallonage tax (per gallon, 235 ILCS 5/8-1, 2026-07-01) and the GİB ÖTV (III)(A)
schedule (4760 sayılı Kanun, 2025-12-31) — each carrying its statute and its
effective date, and **none of them fetched here**: all three were measured on
2026-09-05 with `robots.txt` read first and are cited from `price-sources.md`
lines 269, 295, 471 and 565. **The GİB row is the one this ADR's unit rule was
written for**: the schedule states an exact TL figure and does NOT state what it
is per, so it is registered `silent: unit_denominator_not_stated`, shown as
published, and no per-bottle duty is ever derived from it. **The other two now PRINT** (2026-09-05, batch 57), on two person-stated facts
and nothing else: `master_wine_library.abv_percent` — added nullable, with no
default, carrying its author, on the SHARED row and never on a house's alias —
and `beverage_identities.size_ml`, which this ADR's own identity register
already defined as the stated size (*"NULL means unstated. NEVER 750"*).
`master_wine_library.bottle_size_ml DEFAULT 750` is read by nothing in that
path. Where either fact is absent the refusal is printed rather than a blank,
and where a library row names two stated sizes the derivation is refused as
ambiguous rather than resolved by picking one. The rule
`commodity_exposure_rising` is built DARK — its module imports no `NotificationsModule`, so
there is no code path to a person — and it writes verdicts to `neural_footprint_event` with
`outcome` NULL. Nothing about class E in `price_index_postings` changed. The three findings
below stand as written and are what the build followed. Class E as
written here names three sources and one rule (*never called a price for a named
product*). What a class-E series may actually be *used for* — held in a register,
compared, alerted on, or shown — is planned in
[`.planning/07-reference/commodity-signals-plan.md`](../07-reference/commodity-signals-plan.md),
written the same day on the founder's *"a seperate table for index series"* call. Three
of its findings bear directly on this section. **(a)** An index series cannot enter
`price_index_postings` at all: **five separate columns of
`20260904200000_a_posted_price_names_its_state.sql` each refuse it** — `price NOT NULL`,
`currency NOT NULL DEFAULT 'USD'`, `price_unit NOT NULL`, `product_name NOT NULL`, and
`state NOT NULL CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$')`, which no world-scoped index
can satisfy. That is the measured reason the founder's separate table is structurally
required, and it is also why `d7bv` was correctly left unregistered. **(b)** Class E
needs a `value_kind` this ADR has no equivalent of — `price` / `index_number` / `rate` /
`forecast` — because a rate (HMRC duty, the GİB ÖTV schedule) and an index number
(FAO 133.3, ONS `d7bu` 144.0) are both admissible and neither is a price. **(c)** Two
politeness findings measured 2026-09-05 constrain any class-E fetcher this ADR would
authorise: **`www.ams.usda.gov/robots.txt` returns 403**, so under this ADR's own rule no
scheduled fetcher may be pointed at the source it names first — the shell-egg index takes
the Michigan upload path instead; and **`api.bls.gov/robots.txt` returns 200 with
`User-agent: * / Disallow: /`** on the host of a documented, key-issuing, rate-limited
public API, which is an open question about what robots.txt binds and is that plan's Q1.

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

   **ANSWERED by the founder, 2026-09-04: BOTH. Built the same day; Q7 is
   CLOSED.**

   **The reconciliation of the two writers**, stated so neither is mistaken for
   the other:

   * **Write time protects.** It is the only judge that exists in the hours
     between a bad parse landing and any batch running. Without it a
     lost-decimal $2175 sits in the ladder all day. It is decided against the
     priors that happen to be on the register at that instant, and it is
     recorded as `outlier_basis = 'write_time'`.
   * **The re-judge corrects.** It is the only judge that can look twice. A row
     flagged against four neighbours stays flagged forever under the write-time
     writer, even after forty more arrive that prove it ordinary; nothing but a
     pass over the group can clear it. Recorded as `outlier_basis = 'rejudge'`.
   * **The re-judge wins where they disagree**, because it saw more. It
     overwrites a write-time verdict for exactly that reason, and the row keeps
     the reason and the timestamp of whichever judge spoke last.
   * **They share one test and one floor.** `isOutlierAgainstPriors` /
     `flagOutliers` at 3.5 robust deviations, `MIN_OUTLIER_SAMPLE = 5`, imported
     in both places, never re-implemented. A second copy of a dispersion rule is
     a second answer to the same question.
   * **Neither is ever a bound.** No price is clamped, rounded, rejected or
     refused for being extreme by either judge. A flagged row is written,
     stored and visible; the flag only keeps it out of the "cheaper than usual"
     ladder.

   **All three writers are now screened.** The manual observation
   (`vendor-intel/vendor-comparison.service.ts`) was the last one taking the
   column DEFAULT of `false`; it now takes the same test as the own-paper mirror
   and the site sweep, restricted to its own comparison class.

   **What the build added, and where:**

   * `apps/api-gateway/src/vendor-intel/outlier-rejudge.ts` — the pure pass.
   * `apps/api-gateway/src/vendor-intel/outlier-rejudge.service.ts` — the cron,
     **OFF by default** behind `PRICE_OUTLIER_REJUDGE_ENABLED`, plus the status
     record. `GET /vendor-intel/outlier-rejudge/status` and
     `POST /vendor-intel/outlier-rejudge/run` (both owner-only; the hand-run is
     gated on the same flag, or the flag is not a switch).
   * `supabase/migrations/20260905000000_an_outlier_verdict_names_its_reason.sql`
     — `outlier_reason`, `outlier_judged_at`, `outlier_basis`
     (`write_time` | `rejudge`), all nullable, RLS untouched, `is_outlier`
     untouched. NULL is the honest value for every row written before a judge
     existed, and it is what separates "judged clean" from the DEFAULT of a row
     nobody has looked at.

   **A CONSEQUENCE THAT IS THE FOUNDER'S TO ACCEPT OR OVERRULE.** The re-judge
   groups by `(tenant scope, product identity, comparison class)`, with market
   rows (`restaurant_id IS NULL`) forming their own group. That is deliberately
   NARROWER than the reader, which reads `restaurant_id.is.null OR
   restaurant_id.eq.<tenant>` — each house sees market rows unioned with its
   own. A market row therefore sits in as many reader-groups as there are
   houses, and `is_outlier` is ONE boolean on ONE row: it cannot physically
   carry a different verdict per house. Judging a market row against its own
   class of market rows is the only verdict that is true for every reader of it;
   judging it inside one tenant's union would let one house's invoices decide
   what every other house is allowed to see. The alternative — a per-tenant
   verdict table instead of a column — is a larger change and was not made
   unasked.

**Numbering, stated because it is easy to get wrong.** The list above ends at
Q7. **Q8–Q12 are the TR/UK market research's**, and they live in
`.planning/07-reference/price-sources.md` §"Founder-only questions raised by
this research" rather than here, so there is one place to answer them. The size
reader's questions therefore start at **Q13**. (An earlier draft of this section
numbered them Q8–Q11; that draft was lost in the 2026-09-05 scratchpad wipe and
the numbers had been taken in the meantime.)

13. **Three of the sweep's 23 recorded vendor websites are not the vendor's any
    more, and one of them sells clothes.** Measured 2026-09-04:
    `www.banfivintners.com` redirects to `dtoto5000.com`, an online-gambling
    site; `www.henrywine.com` resolves to `vinology.com`, a wine school;
    `www.sevilen.com`, filed as the Turkish winery Sevilen Şarapçılık, is a
    women's clothing retailer whose product links carry `beden=s` ("size: S") —
    and it is the ONLY one of the twenty reachable vendor sites with prices on
    it. `www.charmer.com` returns 114 bytes and no title. Do those four
    `vendor_catalogue` rows get their websites cleared (so the sweep says "no
    website" rather than fetching a casino in the house's name), or corrected,
    or does a periodic identity check get built? **Nothing was changed:
    `vendor_catalogue` is production data and this work wrote nothing.**

    **ANSWERED by the founder, 2026-09-05: clear the three, with a note. Q13 is
    CLOSED for those three and OPEN for the fourth.** The instrument is
    `scripts/clean_vendor_catalogue_websites.py`, which **runs dry by default
    and refuses `--apply` unless `--i-have-the-founders-word` is passed with
    it** (proven: `--apply` alone exits 2 and writes nothing). It prints each
    row's whole tuple, the evidence, the writer, every foreign key that
    references the row, and the exact `UPDATE`. Nothing has been written; the
    dry run of 2026-09-05 read 4 of 4 rows and proposed 3 statements.

    **Re-measured 2026-09-05** with the sweep's own agent, and all three
    reproduce a day later: `www.banfivintners.com` → 2 redirects →
    `https://dtoto5000.com/` (200, 31,988 bytes, title *"TOTO5000: Bandar
    SBOBET Piala Dunia dan Platform Toto Online Resmi No.1"*);
    `www.henrywine.com` → `https://www.vinology.com/` (200, 388,104 bytes,
    *"Philly's Wine School | Sommelier Courses and Wine Classes"*);
    `www.sevilen.com` → `https://sevilen.com/` (200, 570,105 bytes, *"Kadın
    Giyiminde Tarz ve Kalitenin Adresi - Sevilen"*).

    **The change is `website = NULL` plus a dated sentence appended to `notes`,
    and it is an UPDATE, not a DELETE.** `vendor_catalogue` has no `metadata`
    column and no `website_note` column — measured against the baseline
    (`…baseline_from_production.sql:6230-6247`) and every later `alter table
    vendor_catalogue add column` — so `notes text` is where the sentence goes.
    Seven constraints reference `vendor_catalogue(id)` and three of them
    CASCADE (`vendor_service_territories`, `vendor_locations`,
    `vendor_portfolio_facets`); `vendor_price_observations.vendor_catalogue_id`
    points at the table with no constraint at all. **An UPDATE of a non-key
    column fires none of them**, which is the reason the column is cleared
    rather than the row deleted, and the script prints the whole list so that
    reason is visible rather than asserted.

    **The writer is NOT gone, and it is named.** Both seeds were found by grep:
    `supabase/migrations/seed/27_vendor_catalogue_seed.sql` (Banfi
    `a1000001-…-016`, Henry `…-020`, Charmer `…-005`, ending `ON CONFLICT (id)
    DO NOTHING;`) and `supabase/migrations/20260807001752_turkey_distributors_seed.sql`
    (Sevilen `a1000002-…-005`, ending `on conflict (id) do nothing;`). Because
    both key on the row's fixed id and do nothing on conflict, **a cleared
    website is not refilled by a re-run** — for as long as the row keeps its id.
    It WOULD be refilled if the row were ever deleted and re-seeded, which is
    the second reason this clears a column instead of deleting a row.

    **The fourth is now cleared too, and Q13 is CLOSED entirely.**
    `www.charmer.com` answers 200 with 114 bytes:
    `<script>window.onload=function(){window.location.href="/lander"}</script>`
    — a parked domain, i.e. also no longer the vendor's. The first cut printed
    it under a separate "REPORTED ONLY" heading and refused to touch it,
    because the instruction had named three, and widening a cleaning run past
    what was asked for is how a script becomes something nobody decided. The
    founder then said **"Clear it with the three"** (2026-09-05), so it is the
    fourth PROPOSED row, with the same statement shape and the same note. The
    dry run now reads 4 of 4 rows and proposes **4** statements; the REPORTED
    ONLY heading is kept in the code printing "(none)", so the shape that
    reports a row without acting on it is still there for whoever adds the
    next one.

    **One thing found while measuring, which nobody asked about.** All three of
    the US rows carry `verified_at = 2026-08-10T17:21:2x`, set two months after
    the seed. Whatever ran that verification did not check the identity of the
    website it was verifying — a casino's homepage passed it. That is a
    separate defect from this one and is filed as Q26 below.

14. **The sweep is pointed at the wrong population, and it currently reaches
    nothing at all.** The scheduled sweep reads `providers` per restaurant;
    `GET /vendor-intel/site-sweep/status` on the demo house returned an empty
    vendor list, because that house records no provider website. The 23 in
    `vendor_catalogue` are US three-tier wholesalers, importers and Turkish
    producers — **zero of the twenty reachable ones publish a price at all**, so
    there is nothing for a size to be attached to. Every page the size reader was
    built and measured against is a retail merchant shop. Is the sweep meant to
    read merchant shops (which needs a source of shop URLs, and a decision about
    whether a retail shelf price may sit in the same register as a wholesale
    quote), or is the vendor-site sweep simply not the right instrument?

    **ANSWERED by the founder, 2026-09-05: *"Point it at merchant shops, as
    their own class."* Q14 is CLOSED.** Built the same day as a SECOND
    instrument rather than a change to the first — see the section *"The sweep
    that reads merchant shops"* below for the register it writes to, the shop
    registry's shape and the measurement. The vendor-site sweep is unchanged
    and still reads `providers`: a house's own vendors and a public retail shop
    are different classes, and one job doing both would be one flag arming two
    kinds of outbound request.

15. **A pack printed on the page overrides the model's default of 1, and does
    not override a pack the model actually read.** `validateItem` assigns
    `packSize = 1` whenever the model reported nothing, so a 1 carries no
    information and a page that says "6 x 75cl" is read instead — otherwise a
    six-pack's price enters the ladder as a bottle's, six times too high. But
    when the model reports 6 and the page's size statement says 12, this build
    keeps the model's 6 and records both on the row (`raw.modelPackSize`,
    `raw.packFromPageStatement`) rather than refusing. That is a judgement, not
    a measurement: no page in the sample exhibited it. Both halves are pinned by
    tests as of 2026-09-05 — the second half was untested until an audit caught
    it. Should a pack disagreement be a refusal too?

16. **The size fixtures are 282 kB of reduced third-party markup in the repo,
    and CodeQL is now flagging them.** Six merchant pages, mechanically cut down
    from 400–800 kB each to their structured data, their labelled fields and
    every window around a size or a price, with the originals' sha256 recorded
    (`apps/api-gateway/src/vendor-intel/__fixtures__/PROVENANCE.md`). Marketing
    prose was elided, so this is a fixture rather than a copy of the merchants'
    pages — but it is still their markup, in our repository, and CodeQL raises
    warnings inside it on every run (`corrections-queue.md` proposes a
    `paths-ignore`). Keep it with the ignore (it is the only regression corpus
    the reader has), trim it, or move it out of the repo?

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

## How a size is read (2026-09-04; this section rewritten 2026-09-05 after the scratchpad wipe)

The founder asked whether the sweep may take a bottle size stated **anywhere**
on the page rather than only beside the price, and said: *"research do the best
one if it was live SOTA"*. This section is the answer, the evidence it rests
on, and what was built (`fb47d99c`). Code:
`apps/api-gateway/src/vendor-intel/bottle-size.ts`, `bottle-size.spec.ts`,
`bottle-size-fixtures.spec.ts`, `__fixtures__/PROVENANCE.md`.

Stated because it changes what can be re-checked: this section was written on
2026-09-04, lost uncommitted in the 2026-09-05 scratchpad wipe, and rewritten
from the committed tree. Every number below was re-measured on 2026-09-05 with
the command named, EXCEPT the fetch-time facts about the 23 vendors and the six
merchant pages, which were measured on 2026-09-04 against recorded files the
wipe destroyed. Those are marked, and the fixtures' sha256 in
`__fixtures__/PROVENANCE.md` remains the tie back to re-fetchable sources. The
two things that CAN be re-read from the live gateway — the 23-vendor count and
the sweep's reach — were re-measured on 2026-09-05 and are marked as such.

### What the live state of the art does

Two commercial extractors publish their own answer, both fetched 2026-09-04:

- **Zyte** ships the instruction it gives its model, in order of preference
  (`zyte_common_items/items/product.py`,
  <https://raw.githubusercontent.com/zytedata/zyte-common-items/main/zyte_common_items/items/product.py>):
  the size of the *default selected variant*, then the *most specific*, then
  the *most clarifying*, then the *most obvious one — introduced by a label
  like "Size", "Dimensions"* — and the product name **"as a very last
  resort … and only if you cannot find any other size information in the
  page."** Its `additionalProperties` hint refuses cherry-picked pairs: a
  property counts only inside a block that is "mostly key/value
  specifications". `size` is returned as the raw displayed string; Zyte does
  not normalise it to a number and a unit.
- **Diffbot**'s Product API returns `size` with its own published caveat,
  *"Highly experimental and often unreliable"*
  (<https://diffbot-php-client-docs.readthedocs.io/en/latest/api-product.html>).
  Its `specs` field is name/value pairs, nothing more.
- **Firecrawl**'s `extract` documents no guarantee that an extracted value
  appears on the page, no null-handling contract and no hallucination guard,
  and states results "might differ across runs"
  (<https://docs.firecrawl.dev/features/extract>). Apify publishes no
  cross-site normalised product schema at all; its output is per-actor.

So the state of the art is **not a field**. It is a ranked set of identified
places, the raw string kept beside the number, and the title last. Nobody
normalises, and the one vendor that returns a size at all says out loud that it
is unreliable. What none of them has is a refusal, because a missing size in a
dataset is a blank cell; here it is a false best price on a ladder a person
acts on.

### Where a size is machine-readable at all

Fetched and read on 2026-09-04:

| carrier | what it holds | verdict |
|---|---|---|
| schema.org `Product.additionalProperty` / `hasMeasurement` / `size` | a `PropertyValue` or `QuantitativeValue`; `size` may be `Text`, `QuantitativeValue`, `DefinedTerm` or `SizeSpecification` (<https://schema.org/Product>) | **read**, and the only place a merchant states the volume as data |
| `UnitPriceSpecification.referenceQuantity` + `unitCode` | *the reference* a unit price is quoted per (<https://schema.org/UnitPriceSpecification>: "the reference quantity for which a certain price applies") | **not a bottle size.** It says "per 75 cl", not "this bottle is 75 cl". Used only in the derivation below |
| UN/CEFACT Rec. 20 codes | `LTR` litre, `MLT` millilitre, `CLT` centilitre (published code list, fetched 2026-09-04) | **read**, case-sensitively — `MLT` is a code, `ml` is a word |
| Shopify `unit_price_measurement` | `{measured_type: "volume", quantity_value: 750, quantity_unit: "ml", reference_value: 1, reference_unit: "L"}` (<https://shopify.dev/docs/api/liquid/objects/unit_price_measurement>) | **read** — the cleanest declaration that exists. Measured **null on 4 of 4** Shopify shops read that day, three of them UK |
| Shopify variant `option`/`title` | free text: `"1x75cl"`, `"1 / 1L / Red"`, with the option NAMES on the product (`["Bottle","Size","Color"]`) | **read** — in practice the commonest machine-adjacent carrier |
| Shopify `grams` / `weight` | **not the liquid.** Measured: Tanners `75000` on a 75cl champagne, Slurp `2000` on a 75cl rosé, Hedonism `1500`, Wine Chateau `2722` on a 1 L cabernet | **never read** |
| Google Merchant `unit_pricing_measure` | "750ml", "9l"; units ml/cl/l/cbm/floz/pt/qt/gal; mandatory in the EU, EFTA, UK, AU, NZ for goods sold by volume (<https://support.google.com/merchants/answer/6324455>) | a **feed** attribute; it is not emitted into page markup, so there is nothing to read |
| GS1 `gs1:netContent` | net content as a `gs1:QuantitativeValue` (value + `unitCode`) | **read** if present. `gs1.org` refused this environment's bot user-agent even for `robots.txt`; recorded **unverified**, never as unavailable |
| Open Graph `product:*` | `og:price:amount` / `og:price:currency`; **no** unit-pricing tag (<https://developers.facebook.com/docs/marketing-api/catalog/reference/>) | nothing to read |
| WooCommerce `WC_Structured_Data::generate_product_data()` | measured against the source (`plugins/woocommerce/includes/class-wc-structured-data.php`, trunk, fetched 2026-09-04): emits `@type/@id/name/url/description/image/sku/gtin/offers` and, for variable products, a `UnitPriceSpecification` **carrying only a price**. It sets **no** `size`, `weight`, `additionalProperty`, `referenceQuantity` or `unitCode` | **a WooCommerce shop's JSON-LD never carries the bottle size**, by construction |

### The law, and what it is actually worth here

A unit price beside the selling price is compulsory for prepacked drinks in the
EU (Directive 98/6/EC art. 3; "unit price" defined in art. 2 as the price "for
one kilogramme, one litre, one metre, one square metre or one cubic metre") and
in the UK (Price Marking Order 2004 art. 5, with **Schedule 1 setting the
quantity for "Wines, sparkling wine, liqueur wine, fortified wine" at 75 cl**
where the default in art. 1(2) would be a litre). Türkiye's Fiyat Etiketi
Yönetmeliği requires the same *birim fiyat* on a retail label; the ministry's
own PDF could not be fetched from this environment (TLS chain), so it is
recorded here as **stated in secondary sources and not verified** — the same
refusal by `mevzuat.gov.tr` that the TR/UK research records under Q8.

That makes a unit price a legal statement about *this* price, which is why it
sits third. But measured against the pages we could actually read, it is worth
much less than it sounds: **not one of the six product pages fetched printed a
selling-price unit price**, and the only per-quantity prices on any of them
were Hedonism's duty-rate table — "£2.87 per 75cl bottle", "£3.10 per 75cl
bottle", "£11.47 per 70cl bottle" — three strings that look exactly like a
unit-price label and are not one. So the derivation is implemented, is
restricted to a label within 400 characters of this row's own price, and its
result is accepted only when it lands within **1%** of a quantity a bottle is
permitted to be.

1% and not 2%, because the closest pair on the list is 700 ml and 720 ml, 2.86%
apart: a 2% window around 730 reaches 720 and would snap a derivation that
means neither. `deriveFromUnitPrice`'s docstring said 2% until 2026-09-05 while
the code had already been tightened to 1%; both now say 1% and a test pins it
(a 730 ml derivation is refused, and the same arithmetic onto 720 still passes).

Those permitted quantities are not a taste list: Directive 2007/45/EC's Annex
prescribes them, and its wine rows are quoted verbatim in the code — still wine
100·187·250·375·500·750·1000·1500 ml, yellow wine 620, sparkling
125·200·375·750·1500, spirits 100·200·350·500·700·1000·1500·1750·2000. The
`KNOWN_FORMATS` list already in `vendor-page-extraction.ts` had no source at
all; this one does.

### The precedence that was built, and why in that order

The ordering principle is **not** "most machine-readable". It is *how tightly
the statement is bound to the price being recorded*, because the only thing a
sighting must never get wrong is which unit its number is in.

1. `structured_offer` — a volume inside the same schema.org node as the price,
   or Shopify's declared `unit_price_measurement`.
2. `variant_option` — the option label of the variant the price belongs to.
   Zyte puts the selected variant first for the same reason.
3. `unit_price_label` — the compulsory per-litre/per-75cl figure, beside this
   price, derived and snapped as above.
4. `spec_field` — a labelled key/value in the page's own specification block.
5. `title` — the product's own name, last, exactly as Zyte instructs.

Nothing else is a candidate. **"Anywhere on the page" was measured and
rejected**, and the measurement is in §"What the sweep's 23 vendors actually
publish" below: three of the sweep's own recorded vendor websites are no longer
the vendor's, and one of them — filed as the Turkish winery Sevilen — is a
women's clothing shop whose product links carry `beden=s`. A reader that took a
size stated anywhere would read a dress size under a wine vendor's name.

Two further rules, both from measurement rather than from taste:

- **An identity gate on structured data.** `bbr.com/products-20188000200-2018-champagne-dom-perignon-brut`
  returned HTTP 200 with `og:title` "2018 Champagne Dom Pérignon, Brut" and
  exactly one JSON-LD block, describing **Caol Ila 25-Year-Old whisky** at £225
  with SKU `1000-01-00700-00-8086983`. Structured data is the
  highest-precedence source and the lowest-trust identity: it is machine
  written, so it can be machine wrong, and nothing on the page says so. A node
  is read only when its SKU or its name matches the row being priced;
  otherwise the row is refused and the note says which product the markup named.
- **A conflict is a refusal, not a choice.** Two statements that disagree
  produce `volume_conflict`, a new `ScrapeRefusalReason` counted separately
  from `no_bottle_volume`. Folding them together would make "this merchant
  contradicts itself" render as "this merchant does not print sizes", which is
  the standing absence-reported-as-health fault in a new place.

The winning statement, the raw string, the locator and **every** candidate go
into `raw.volume` on the row, so a sighting says not only that it is 750 ml but
where on the vendor's page that 750 came from and what the page actually wrote.
Named exactly as the code names it, because `fb47d99c`'s commit message called
it `volume_source` and there is no such field: it is **`volume.source`** on the
input and `raw.volume.source` on the row, beside `raw.volume.statement` (the
page's own words), `raw.volume.locator` (where they were read),
`raw.volume.candidates[]`, `raw.volume.nonStandardFormat` and
`raw.volume.notes[]`. `unit_volume_ml` remains the column; `raw.volume` is its
provenance, and nothing was added to the table.

### Why this reads the markup and not the model's text

`htmlToText` (`common/html/html-to-text.ts`) drops the *contents* of `<script>`,
deliberately and correctly. schema.org JSON-LD lives inside
`<script type="application/ld+json">`. So before `fb47d99c` the extraction model
had never once been shown a vendor's structured data, and **every `Bottle
Volume` a merchant publishes was being discarded before the model saw it.** That
is not a tuning problem; it is why the highest-quality carrier scored zero.

### What this does not do, stated rather than left to be discovered

- **The identity gate can refuse a good page.** It matches the model's product
  name against the markup's, by SKU or by name containment or by a 0.6
  token-overlap. A merchant whose JSON-LD names the wine differently from its
  own visible heading will fail that test and the row will be refused
  `no_bottle_volume` with the note saying which name the markup used. That is
  the safe direction — the alternative is the Dom Pérignon case, where a
  confident whisky is filed under a champagne — but it IS a false-refusal path
  and the note is what makes it findable. No sample page exercised it.
- **`unit_price_label` has no coverage from a real page.** Not one of the six
  pages fetched printed a selling-price unit price, so that level is proven only
  by unit tests built from the law (Price Marking Order 2004 sch. 1's 75 cl) and
  by the Hedonism duty table, which it correctly refuses. It is implemented
  because it is compulsory in two of the tenants' jurisdictions and it will
  appear the moment the sweep is pointed at an EU or UK grocer; it is not
  implemented because it was measured working.
- **A pack disagreement is recorded, not refused.** A pack the size statement
  itself names ("6 x 75cl") corrects the model's default of 1 — `validateItem`
  assigns 1 whenever the model reported nothing, so a 1 carries no information —
  but it never overrules a pack the model actually read; both go on the row as
  `raw.modelPackSize` and `raw.packFromPageStatement`. Both halves are pinned by
  tests as of 2026-09-05; the second half was untested until then. See Q15.
- **`gs1:netContent` is read but unverified.** `gs1.org` refused this
  environment's robots.txt to an identifying bot user-agent, so the property is
  implemented from its published definition in the GS1 Web Vocabulary
  (`ref.gs1.org/voc/netContent`) rather than from a fetched page. Nothing in the
  sample emitted it.
- **Nothing here reads a size out of free text.** A volume that appears in prose,
  in a tag list, in a description or in a neighbouring product's card is not a
  candidate. That is the direct answer to the founder's question and the
  measurement below is why.

### The measurement, before and after, on six real pages

Six merchant product pages fetched 2026-09-04 (robots first, 10 s per host, full
provenance and sha256 in `__fixtures__/PROVENANCE.md`). Re-run on 2026-09-05 on
the committed tree; BEFORE loads verbatim `git show fb47d99c^:` copies of
`html-to-text.ts` and `vendor-site-sighting.ts` — the tree as it stood
immediately before the reader landed — from a scratch directory. No file in the
worktree was reverted.

```
BEFORE — the tree at fb47d99c^ (git show copies), the model's text only:
  bbr-cremant-de-limoux-2026-09-04.fixture.html  REFUSED no_bottle_volume — the model's text contains no size at all (the bottle is 750ml)
  bbr-dom-perignon-2026-09-04.fixture.html       REFUSED no_bottle_volume — the model's text contains no size at all (the bottle is unstated on this page)
  slurp-pellehaut-rose-2026-09-04.fixture.html   WRITES    750ml — the only size in the model's text (the bottle is 750ml)
  tanners-andre-clouet-2026-09-04.fixture.html   WRITES  one of [700,750]ml — whichever the model picked; the row records neither which nor why (the bottle is 750ml)
  hedonism-ruinart-2026-09-04.fixture.html       WRITES  one of [700,750]ml — whichever the model picked; the row records neither which nor why (the bottle is 750ml)
  winechateau-caymus-1l-2026-09-04.fixture.html  WRITES   1000ml — the only size in the model's text (the bottle is 1000ml)
  admitted 4/6   refused 2/6   of the admitted, 2 were admitted from a text offering more than one size

AFTER — bottle-size.ts reading the markup:
  bbr-cremant-de-limoux-2026-09-04.fixture.html  READ      750ml  structured_offer  "75 cl" @ ld+json[0].hasVariant[0].additionalProperty[Bottle Volume]
  bbr-dom-perignon-2026-09-04.fixture.html       REFUSED        no_bottle_volume
  slurp-pellehaut-rose-2026-09-04.fixture.html   READ      750ml  variant_option    "1x75cl" @ variants[].title = "1x75cl"
  tanners-andre-clouet-2026-09-04.fixture.html   READ      750ml  spec_field        "Bottle size cl: 75" @ <span title="Bottle size cl: 75">
  hedonism-ruinart-2026-09-04.fixture.html       READ      750ml  spec_field        "75 cl" @ .product__unit-size
  winechateau-caymus-1l-2026-09-04.fixture.html  READ     1000ml  variant_option    "1L" @ variant option "Size" = "1L"
  admitted 5/6   refused 1/6   wrong 0
```

Read plainly: the pre-reader tree admits four and refuses two, and **two of the
four it admits are chosen out of a text that offers two different sizes**, with
nothing on the row saying which was chosen or why. The reader admits five,
refuses the one page that genuinely says nothing about this row, and every
admitted row names its source and carries the page's own words. The BBR crémant
line is the whole argument in miniature: the merchant publishes
`"Bottle Volume": "75 cl"` as data, and the pre-reader tree cannot see it
because it is inside a `<script>`.

**One check in `__fixtures__/PROVENANCE.md` is no longer re-runnable.** That file
records that the reader gave the same answer on each fixture as on the whole
page it was cut from (6/6), and that the largest original — 800 kB — read in
13 ms. Both were measured on 2026-09-04; the originals lived in the session
scratchpad and were destroyed in the 2026-09-05 wipe. The fixtures themselves,
their sha256 and their source URLs survive, so the check can be re-made by
re-fetching, and until someone does it stands as a record rather than a
verification.

### What the sweep's 23 vendors actually publish

All 23 were fetched on 2026-09-04, robots.txt first, our own UA, a 10-second
floor per host (Palm Bay's robots asked for 2 s; nobody asked for more). The 23
are the active `vendor_catalogue` rows with a website: **18 US + 5 TR**,
counted through `GET /api/v1/vendor-catalogue/search?includeRegistry=true` for
each country. **The count was re-measured on 2026-09-05** against the live
gateway (`GET /api/v1/vendor-catalogue/search?limit=50&includeRegistry=true&country=US`
then `…&country=TR`, read-only with a dev-bypass owner session): **US total 18,
all 18 with a website; TR total 5, all 5 with a website — 23.** The rest of this
paragraph is the 2026-09-04 fetch and was NOT re-run: those logs were lost in the
wipe, and re-crawling 23 third-party sites is a fresh crawl, not a re-check.

- **20 of 23 answered HTTP 200.** Empire Merchants answered **400** to both
  robots.txt and the page; `www.terlatowines.com` presents a certificate that
  is not valid for that hostname; `www.kayrasaraplari.com` does not resolve.
- **0 of the 20 emit a schema.org `Product`.** The JSON-LD they do publish is
  `Organization`, `WebSite`, `WebPage`, `BreadcrumbList`, `ImageObject`,
  `LocalBusiness`, `Store` and one `Event` with an `Offer` for a tasting class.
- **0 emit** microdata `Product`, `og:type=product`, `UnitPriceSpecification`,
  `referenceQuantity`, `additionalProperty`, `hasMeasurement`, `gs1:`,
  `unit_pricing_measure`, or a per-litre label.
- **1 of the 20 shows any currency-formatted price on its landing page** — and
  it is the clothing shop below.
- Platforms: WordPress 11 (WooCommerce 4 of those), Drupal 1, HubSpot 1,
  7 unrecognised.
- **Three of the 23 recorded websites no longer belong to the vendor.**
  `www.banfivintners.com` redirects to `dtoto5000.com`, an Indonesian
  online-gambling site. `www.henrywine.com` resolves to `vinology.com`, a
  Philadelphia wine school. `www.sevilen.com`, filed as the Turkish winery
  Sevilen Şarapçılık, is a women's clothing retailer — the only one of the 20
  with prices on it, and its product links carry `beden=s` ("size: S").
  `www.charmer.com` returns 114 bytes and no `<title>`.

Two consequences follow, and neither is about the size reader.

First, **the size question is decided by pages the sweep does not currently
reach.** The US wholesalers and importers in `vendor_catalogue` are three-tier
trade houses; they do not publish prices, so there is nothing for a size to be
attached to. The six pages the reader was built and measured against are real
merchant shops, which is what the sweep would have to be pointed at for any of
this to matter.

Second, **the sweep's reach for the demo house is zero.** The scheduled sweep
reads `providers`, not `vendor_catalogue`; `GET /vendor-intel/site-sweep/status`
returned `armed: false`, `lastRun: null` and an **empty vendor list**, because
this house has no provider with a website recorded. Measured 2026-09-04 and
**re-measured on the live gateway on 2026-09-05** (read-only, owner session):
identical — `{armed: false, flag: "VENDOR_SITE_SWEEP_ENABLED", cron: "20 4 * * *",
hostIntervalSeconds: 10, inMemoryOnly: true}`, 0 vendors. The flag was not
touched and nothing was fetched by the gateway.

## Non-US markets: Türkiye and the United Kingdom (2026-09-05)

> Numbering note (2026-09-05): this section's founder questions are **Q22–Q25**. They were first written as Q13–Q16 while the size reader's section, rewritten the same morning, took Q13–Q16 and the Michigan/Illinois section took Q17–Q21; the parent renumbered this section so every question in the ADR has one number.

**This answers Q4.** Told that two of fourteen houses sit in Türkiye and one in the United
Kingdom and that all three resolved to "not a jurisdiction", the founder chose, 2026-09-05:
**"their own source class, researched per market"** — each market gets a named class of
public price source, or an honest "none found" with the sentence that proves it, and the
register learns ISO country and region codes. The 2026-09-04 pass established the shape of
both markets; this pass re-measured every load-bearing claim, found the one UK source that
survives the test, found the trap that would have swallowed the obvious alternative, and
built the codes. Every fetch below is in `$SP/p4ab-fetch-log.md` with its status and first
bytes.

### The finding, first: three houses had been told a falsehood

Read off the production tenant rows on 2026-09-05 (a read; nothing was written):

| house | city | `state_province` | `country` | resolved before | resolves now |
|---|---|---|---|---|---|
| Chez Community | Fethiye | `Muğla` | `Türkiye` | null | `TR-48` |
| The Old House Pub | Antalya | `NULL` | `Türkiye` | null | `TR` |
| ADMIN 1 | London | `England` | `United Kingdom` | null | `GB-ENG` |

All three got *"X is not a jurisdiction this register recognises."* That sentence is false
about Muğla, England and Türkiye and true only about our table — the absence-reported-as-health
fault wearing a geography costume. Two distinct silences had been collapsed into one: **a place
we do not know** and **a place with no source**. The build separates them.

### Türkiye: none found, and the sentence that proves it

Every Turkish candidate was re-fetched on 2026-09-05.

* **HKS — Ticaret Bakanlığı hal bulletin** (`https://www.hal.gov.tr/Sayfalar/FiyatDetaylari.aspx`,
  HTTP 200, 64,583 bytes). Live, public, no login, headed *"Bülten Tarihi : 5.09.2026 (4.09.2026
  Tarihli Veriler Kullanılmıştır.)"*, with a real row read verbatim:
  `ACUR | ACUR | Geleneksel(Konvansiyonel) | 23,78 | 69216 | Kg`. It is the closest Türkiye comes
  to a public price index — and it is **not machine-readable**: the served HTML references no
  `.ashx`, `/api/` or `.json` endpoint at all, its export ("Aktarma Seçenekleri") is a postback
  control rather than a URL, and pages after the first need `__VIEWSTATE`. No currency is stated
  on a row. Both machine alternatives failed the same day: `data.ibb.gov.tr` **HTTP 403** and
  `halfiyatlaripublicdata.ibb.gov.tr/swagger/docs/v1` an **empty reply**. Recorded `silent:
  no_machine_endpoint`. Parsing page one and calling it the bulletin would report a fraction of
  a market as the market.
* **GİB ÖTV (III)(A)**. `gib.gov.tr/robots.txt` HTTP 200, `User-agent: * / Allow: /`; the ÖTV
  landing page HTTP 200 (39,777 bytes) — but a Next.js shell with **no PDF link and no
  `cdn.gib.gov.tr` reference in its served HTML**, so the schedule was not re-read today and the
  2026-09-04 reading is cited as that day's. It is a tax, not a price, and the unit the figure is
  per is not stated on the face of the table. Recorded `silent: not_a_price`.
* **TÜİK**. `veriportali.tuik.gov.tr/robots.txt` HTTP 200 — `Allow: /`, and it still names
  `anthropic-ai`, `ClaudeBot`, `ClaudeUser` and `Claude-SearchBot` in an explicit allow group, the
  only source in this register that permits us by name. Its own sitemap advertises
  `/sdmx-web-service-documentation` and `/bulk-download`, so **a machine route is claimed to
  exist** — but both pages render *"JavaScript Required"* to a fetcher and the entry bundle names
  no API base. Unverified, and worth one more look (Q22). Even if reached, a CPI series is an
  index number, not a price (see the UK note below on why that matters).
* **Producers**. `kavaklidere.com` allows `*` but blocks GPTBot, CCBot, Google-Extended and AdsBot
  by name; `doluca.com` **disallows `/shop/`**; `diageoturkiye.com` **disallows its own catalogue**
  (`/markalarimiz/katalog`). None publishes a price.
* **Retail**. `migros.com.tr/robots.txt` HTTP 200 — `Disallow: /arama` (search) only, so a
  catalogue could be enumerated by sitemap; `carrefoursa.com/robots.txt` **HTTP 403**. Moot for
  drink either way: online alcohol sale is unlawful in Türkiye.
* **Primary law, still unverified for a second day.** `mevzuat.gov.tr` timed out (45s) and
  `resmigazete.gov.tr` redirected to `http://` and returned **HTTP 400** with an empty error body.
  The statutory claim (Law 4250 md. 6; the sales regulation md. 11) therefore still rests on
  secondary commentary. Q8 stands.

**Verdict: none found.** Türkiye gets the honest sentence, not a source.

### The United Kingdom: one source found, and one trap avoided

* **The trap, and it is the important finding of this pass.** ONS publishes four RPI
  average-price series for drink — `KEF4` wine per 175ml glass, `CZMS` draught lager per pint,
  `CZMT` draught bitter per pint, `CZMR` whisky per nip. Each is a **money figure in pence with a
  stated measure and a monthly date**, keyless, OGL v3.0: everything this ADR asks of a sighting.
  Fetched 2026-09-05, all four **HTTP 200**. And every one's **last observation is 2025 JAN**
  (517p / 483p / 380p / 390p) — nineteen months ago — while the same payload's `releaseDate` says
  **2026-08-18** and its `nextRelease` says **16 September 2026**. A food series sampled the same
  way (`CZNJ` tomatoes) stops in the same month, so the family has stopped, not only drink.
  **This is the `bh_fv020.txt` fault in a better disguise:** there, a 200 carried a visibly old
  report; here a 200 carries a *fresh-looking publisher field* wrapped around a dead series. A
  fetcher trusting either the status code or `releaseDate` would file a nineteen-month-old price
  as this month's. The staleness gate catches it **only because it reads the observation's own
  date** — which is the whole argument for that gate, now confirmed twice.
* **HMRC alcohol duty.** Guidance page HTTP 200 (90,801 bytes); the **GOV.UK Content API** returns
  HTTP 200 with `public_updated_at` `2026-02-01T00:15:01Z` and organisation
  *"HM Revenue & Customs"* — issuer and date both machine-readable, and still **no price**. The
  table gives a rate per litre of pure alcohol (wine and spirits 3.5–8.4% GBP 26.61, 8.5–22%
  GBP 30.62, over 22% GBP 33.99; beer 3.5–8.4% GBP 22.58). Multiplying it by the house's own ABV
  and volume produces a figure no issuer published. Recorded `silent: not_a_price`.
* **No open dataset exists.** `ckan.publishing.service.gov.uk` (the data.gov.uk API) returns
  **2 results** for `alcohol price` — both *non-alcoholic* beverage CPI from the Greater London
  Authority — and **1 result** for `wine OR spirits OR beer price`: HMRC's *Alcohol Duties
  Factsheet*. The UK state publishes the tax and nothing else about what drink costs.
* **Trade is class C without exception.** `mcbdrinks.co.uk/robots.txt` allows everything but
  `/umbraco/`, and its own wine listing (`/products/wine`, HTTP 200, 71,184 bytes) carries **zero
  `£` figures** and a "Customer Login" — the largest UK on-trade drinks wholesaler permits the
  crawl and has nothing priced to read. `lwc-drinks.co.uk` allows all with `Crawl-delay: 10`;
  `bibendum-wine.co.uk` redirects into MCB; `enotria.co.uk` returned **522**.
* **Retail cannot even be asked.** `majestic.co.uk/robots.txt` **403** (a Cloudflare interstitial),
  `tesco.com/robots.txt` **403**, `waitrose.com/robots.txt` a **transport failure** (HTTP/2
  INTERNAL_ERROR). Three for three, on a second consecutive day: **until a robots.txt is actually
  read, no UK retail sweep may be written.**
* **WSTA** re-read: *"All data not to be shared outside of WSTA member organisation."* Volume and
  value, not price. Not a source.
* **Scotland's MUP** returned **HTTP 202 with a zero-byte body** (a bot challenge). It is also a
  legal floor rather than a price, and Scotland-only — the estate's one UK house is in London, so
  it would not reach it even if read. This is precisely why the codes are regional and not just
  `GB`.
* **The one source that survives: Defra's wholesale fruit and vegetable prices.** Series page
  HTTP 200; CSV HTTP 200, **861,585 bytes**, sha256
  `ab56ded3a4bc3f65fd49e438fc6b43d7a0a9f22f2595afd1c2049941cc258c3d`, **17,594 rows**, headers
  exactly `category,item,variety,date,price,unit`, newest date **31/08/2026** with 55 rows, zero
  blank prices and zero blank units, and exactly one published price of 0
  (`cut_flowers,gladioli,all_varieties,05/07/2024,0,stem`). The page states its own issuer
  (*Department for Environment, Food & Rural Affairs*), cadence (*fortnightly*), extent
  (*"in England and Wales"* — Birmingham, Bristol, Manchester and a London market) and licence
  (**Open Government Licence v3.0**). It carries every fact this ADR requires **and** is
  machine-readable. **It is produce, not drink, and that is stated everywhere it appears.**

### What was built, and the constraint that shaped it

`apps/api-gateway/src/price-index/jurisdiction.ts` (new) teaches the register:

* **ISO 3166-1 alpha-2** `TR`, `GB`, `US` — a house or a source known only to its country.
* **ISO 3166-2:TR** `TR-01`…`TR-81`, all 81 provinces, from a listing **fetched today** rather
  than remembered. `Muğla` → `TR-48`, `Antalya` → `TR-07`. Names are diacritic- and case-folded,
  so `MUĞLA`, `mugla` and `İstanbul` all resolve.
* **ISO 3166-2:GB** `GB-ENG`, `GB-SCT`, `GB-WLS`, `GB-NIR`, plus the remark-part-2 extents
  **`GB-UKM`** (United Kingdom) and **`GB-EAW`** (England and Wales) — because UK publications are
  issued at exactly those extents, HMRC's UK-wide and Defra's England-and-Wales.

**The constraint that decided the keys.** `price_index_postings.state` carries
`CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$')`
(`20260904200000_a_posted_price_names_its_state.sql:57`). A bare country code has no hyphen and
**cannot be written**: `GB` and `TR` fail that pattern; `GB-ENG`, `GB-EAW`, `GB-UKM` and `TR-48`
pass it. (Measured earlier on 2026-09-05 against a local Postgres built from these migrations —
an INSERT with `state` `'GB'` was refused by constraint name — and re-checked against the pattern
itself afterwards, because that container did not survive the session crash.) So the UK sources
are keyed to codes the standard already provides and the constraint already admits, and **no
migration was needed**. A Türkiye-wide source would need one; none can produce a row today, so
none was added on speculation.

**Coverage is containment, and deliberately not symmetric.** `GB-UKM` covers `GB-ENG`; `GB-EAW`
covers `GB-ENG` and `GB-WLS`; `TR` covers `TR-48`. But **`GB-EAW` does not cover a house known
only as `GB`** — that house may be in Scotland, where a Birmingham wholesale price is not the
market. Guessing the other way is how a register starts answering questions nobody asked.

**A new field, because two silences are two facts.** `SourceEntry.silent` sits beside `withheld`
and never replaces it: `withheld` means *we could not get the bytes* (Michigan's 403);
`silent` means *we got them, read them, and there is no price in them for this register* —
`not_a_price` (HMRC, GİB), `discontinued` (ONS), `no_machine_endpoint` (HKS). Michigan's entry
was not touched.

**Five registry entries** were added: Defra (**the only one with a parser**), HMRC, ONS RPI, GİB
ÖTV, HKS. **`parse-defra.ts`** admits the newest edition and refuses the rest by name, with the
price check deliberately BEFORE the date check — a row publishing 0 is not a price at any date,
and refusing it as "old" would file the wrong defect. Rows carry `GBP`, `per kg`/`per head`/
`per stem`, `GB-EAW`, the OGL attribution the licence requires, a NULL container size (never a 0),
and a `source_ref` keyed on the **series page** rather than the edition URL, whose content hash
changes every fortnight.

**`forHouse` now reads `country` as a fallback**, region first. That is what makes the Antalya
house resolvable at all: it records no province, and its country is the level Türkiye publishes
at. And a US house that records a country but no state is told *"set the state"* rather than
*"nothing is posted"* — because in the United States price posting is a state power, and the two
sentences are not interchangeable.

Nothing is armed. `PRICE_INDEX_FETCH_ENABLED` remains off, so the Defra parser writes nothing
until the founder decides whether a drinks house should see a produce line at all.

### Rejected alternatives

1. **A per-bottle duty line** (ABV × volume × the HMRC or ÖTV rate). Rejected as the register's
   content: it is arithmetic wearing a citation — no issuer published that number for that
   bottle — and it inherits every error in the house's own ABV and volume, the least-verified
   data in the ledger, while carrying a government name that makes it read as authoritative.
   Recorded instead as a `not_a_price` source so the box can SAY the duty exists. Whether to
   compute it anyway is the founder's, and stays open.
2. **Writing the ONS CPI alcohol index (`d7bv`, 2026 JUL = 159.9) as an index line.** Rejected on
   the table's own shape: `price_index_postings` requires `price`, `currency CHAR(3)` and
   `price_unit` NOT NULL, and the ONS payload declares its own unit as *"Index, base year = 100"*.
   Filing 159.9 with a currency would be inventing one. Class E has no home in this table for a
   unitless index, and that is a real gap rather than an oversight (Q23).
3. **A migration relaxing the `state` CHECK to admit a bare country code.** Rejected as unasked
   and unnecessary: `GB-UKM` and `GB-EAW` are real ISO codes that already pass, and no Turkish
   source can write a row for the relaxation to serve.
4. **Scraping page one of the HKS grid.** Rejected: it would report a fraction of a national
   market as the market, and the refusal is the honest outcome.
5. **Mapping only the two Turkish provinces with a house.** Rejected: it would leave 79 real
   jurisdictions being told they do not exist — the same fault this section opened with.

### Founder-only questions raised by this pass

22. **TÜİK claims an SDMX web service in its own sitemap and is the one source that permits us by
    name — worth one more agent to find the endpoint?** Both its documentation pages render
    "JavaScript Required" to a fetcher. Even if found it yields index numbers, not prices, so it
    cannot enter this table today (Q23) — but it would give Türkiye a labelled index line the day
    that changes.
23. **Class E has no home in `price_index_postings` for an index NUMBER.** The type union and the
    CHECK both admit `public_index`, but the columns require a price in a currency with a unit.
    Every genuine public index found for either market (ONS `d7bv`, TÜİK CPI) is unitless. Add
    the columns, keep a separate table, or drop class E from the union and say so?
24. **Should a drinks house be shown a PRODUCE line?** Defra is real, dated, licensed, fetchable
    and about vegetables. It is built and disarmed. This is Q11's other half, now with a working
    parser behind it, and it is one environment variable from being live.

    **ANSWERED by the founder, 2026-09-05, and CLOSED:** *"Show it, labelled as produce, in its
    own box"* — an honest index of the market the house also buys from, never beside a wine
    quote; the label says what it is. BUILT the same day:

    * **Its own box, titled by the source's own words.** `MarketIndexPanel.tsx` splits the
      register's lines on whether their SOURCE carries `display` in the registry — not on the
      class, so the rule lives where the evidence is. A labelled source draws in a titled
      `<section>` of its own, below the drinks list and never beside it:
      `Wholesale produce · Defra · England and Wales · read on 5 Sep 2026`, with a sentence
      under it saying *"A market this house also buys from. It is not a drinks price and is
      never compared with one."* The main heading still names the DRINKS class held, so a box
      holding only produce is not announced as a drinks list.
    * **The date on the title is OURS.** "read on", from `fetched_at`, never the issuer's date —
      the one date this box can always stand behind. (The line inside keeps ADR 0117 Q27's
      `issuedAtBasis` rule, so a row still says "issued" only when a publisher stamped it.)
    * **Two rendering faults found in the first capture and fixed.** A produce row was printing
      an em dash for its container size — a size is a fact about a BOTTLE, and a price per
      kilogram has no bottle, so the unknown is dropped rather than shown on a labelled source.
      And it was printing *"to average wholesale market price"*: `to X` names the TRADE LEVEL a
      posting is filed for ("to Retailers"), so the preposition asserted a trade relationship
      the issuer never stated. Both are `labelled`-variant behaviour on `Line`.
    * **The GB sentence stopped saying "none found".** It said no market price is published in
      the United Kingdom — true of DRINK and false of the market as a whole once one source is
      being shown. A sentence claiming nothing was found, beside a box that is showing
      something, teaches a reader to distrust both. It now says *"No drinks price is published
      in the United Kingdom … What was found is Defra's wholesale produce list for England and
      Wales, shown separately and labelled as produce: a market this house also buys from,
      never a stand-in for a wine price."*
    * **And the unarmed sentence names the switch.** The generic *"has a fetchable posted list,
      but the scheduled fetch is off"* was wrong twice for a UK house: there is no posting
      regime in the UK at all, and the source waiting is produce, not drink. A jurisdiction
      whose only fetchable sources are labelled ones now gets
      `unarmedDisplaySilenceFor`: *"Wholesale produce (Defra, England and Wales) is the one
      public list found for this house, and it has not been read yet: the scheduled fetch is off
      until PRICE_INDEX_FETCH_ENABLED is set on the deployment."*
    * **Arming is one thing and one thing only** — setting `PRICE_INDEX_FETCH_ENABLED` to
      "true" or "1" on the deployment. It is not a code change, not a product toggle, and not
      something an agent does. Said in the registry entry, in the endpoint's sentence and in
      `price-sources.md`, because a reader who cannot find the switch assumes the product is
      broken.

    **Proved against the pre-fix component.** A probe copy of HEAD's `MarketIndexPanel.tsx`
    (renamed only, run, then deleted) was rendered with the same two rows — a Defra cabbage and
    an Iowa rye. It produced **one `<ul>` containing both**, under the single heading
    **"Control-state shelf price · GB-ENG"**, with the word "produce" **absent from the entire
    document**: a GBP 0.62 cabbage directly beneath a $34.99 bottle of rye, the whole box
    announced as a control-state shelf price. Six new vitest cases hold the new behaviour, one
    of them asserting that an unlabelled source still draws exactly as it did.

    **What is NOT built, and why.** No row exists to show. `price_index_postings` is absent from
    the project this deployment reaches and the fetch is unarmed, so the captures are a STUB —
    real components, real tokens, real values from the 31/08/2026 edition, a banner saying STUB
    on the face of every shot, and no request leaving the browser. Arming it or writing a row
    would be a production write.
25. ~~**`restaurants.currency` says `USD` for all fourteen houses, the two Turkish and the British
    included** — measured 2026-09-05. This settles Q10: fixing the class-A writer alone fixes
    nothing, because the tenant rows themselves carry the column default. The repair is a data
    correction on three rows, and it is a WRITE, so it was not made.~~

    **ANSWERED 2026-09-05.** The founder, verbatim: *"correct three rows now, ask each house in
    onboarding, but set a default based on location, edge case: there maybe several diff
    currencies, so act accordingly to that"*. Built and recorded in
    **A house names its money, and a recorded price names its own** below. The three rows are
    still USD: the correction is a WRITE and it waits on the founder's word.

## A house names its money, and a recorded price names its own (2026-09-05)

> This section is the amendment that closes **Q25**. It is recorded here rather than as a new
> ADR because it is not a new decision: the founder stated the rule in the three sentences
> above, and this ADR already owns "a price names its unit" — of which "a price names its
> money" is the same sentence about the other half of the figure. ADR 0070 owns the QUANTITY
> axis and ADR 0119 the AGREEMENT's unit; neither owns a price's denomination.

### The measurement, first

Read off production 2026-09-05 (reads only; nothing was written):

| what | count |
|---|---|
| `restaurants` rows | 14 |
| carrying `currency = 'USD'` | **14** |
| of those, houses NOT in a dollar country | **3** (Chez Community and The Old House Pub in Türkiye, ADMIN 1 in the United Kingdom) |
| `price_history` rows | 0 |
| `price_history.currency` column | **absent** |
| `procurement_documents` rows | 5 |
| of those, rows whose currency is not `USD` | **2**, both `TRY` — on a house whose own row says `USD` |
| columns named `currency` in `public` | 6, and **every one of them defaults to `'USD'`** |

**The writer that set USD is the column default.** `restaurants.currency` carries
`DEFAULT 'USD'::character varying` (`20260805000000_baseline_from_production.sql:3576`) and the
only insert that creates a house — `AuthService.registerRestaurant`,
`apps/api-gateway/src/auth/auth.service.ts` — named no `currency` key at all. So no code was
wrong; the COLUMN was the writer, and an unanswered question was stored as a confident answer.
This is [[absence-reported-as-health]] in a column default, the same shape
`20260903170000_a_default_is_not_an_answer.sql` removed from three other columns — a file that
named `restaurants.currency` as deliberately NOT touched because it had not been decided.

The last two rows of that table are the founder's edge case, already live: one house, `USD` on
its own row, holding two `TRY` invoices.

### The rule

1. **`restaurants.currency` is the house's REPORTING currency** — what its own totals are stated
   in. It is stated by a person or it is NULL. No default.
2. **Every recorded price carries ITS OWN currency**, the vendor's, off the vendor's paper.
   Never the house's by inheritance.
3. **Nothing converts.** There is no exchange rate anywhere in this system. A reader that would
   compare or sum figures in different currencies refuses in words instead.

### What was built

- **`supabase/migrations/20260905120000_a_house_names_its_money.sql`** — drops
  `restaurants.currency`'s default, adds an ISO-4217-shape CHECK to it, adds
  `price_history.currency` (nullable, no default, same CHECK), and four column comments carrying
  the rule. **It writes no data**, and it raises a NOTICE naming how many houses still carry
  `USD` so a green migration cannot imply the job is done.
- **`scripts/correct_restaurant_currency.py`** — the three-row correction. Dry by default;
  `--apply` refused unless `--i-have-the-founders-word` is passed with it; `--self-test` needs no
  database. The dry run prints each changing row's whole tuple, the evidence, every foreign key
  that references `restaurants`, and the exact statements. It talks to PostgREST with the
  standard library rather than the `supabase` package — measured on this machine, the repo's own
  `supabase/` directory shadows that package, so `import supabase` succeeds while
  `from supabase import create_client` fails, and the default `python3` does not have it at all.
  `scripts/backfill_restaurant_coordinates.py` carries that trap unfixed.
- **The onboarding step** — `apps/web/src/components/onboarding/CurrencyStep.tsx`, mounted in
  the sign-up form's Location section. A **stated** default from the address's country (ADR 0083:
  the page says what it will record), which the manager confirms or changes, plus "Not yet" as a
  real answer that records nothing. A country the table cannot place gets **no** default and says
  so. The table is `apps/web/src/lib/currency.ts` (ISO 4217 alpha-3, SIX/ISO list A1, compiled
  2026-09-05, no external call).
- **The writers** — `recordPriceHistory` takes a required `currencyClaim` and writes the code or
  NULL plus a logged sentence naming what would have admitted one
  (`apps/api-gateway/src/procurement/price-currency.ts`). `own-paper-sighting.ts`'s
  `(input.currency ?? "USD")` is now a **refusal**; the class-D sweep beside it already refused
  `currency_unstated` with the words "A number without its currency is not a price"
  (`vendor-intel/shop-reference-posting.ts`), so class A defaulting while class D refused was the
  inconsistency.
- **The readers** — `vendor-terms.service.ts` returns `code: string | null` and no longer falls
  back to USD on an unreadable house; `lib/mudavym/format.ts`'s `fmtMoney` renders an unrecorded
  currency as "N (currency not recorded)" rather than a symbol; both terms surfaces say it in
  words.

### Rejected alternatives

- **`price_history.currency` NOT NULL, like `unit`.** Rejected on a measurement, not a
  preference: the RECEIPT path can state a currency (the invoice header carries one, and
  production proves it is sometimes TRY) but the AGREEMENT path cannot — neither
  `procurement_orders` nor `procurement_order_items` has a currency column. NOT NULL would not
  make the agreement state its currency; it would make the agreement path write nothing, deleting
  a whole source from the series to punish a gap in a different table and leaving an empty table
  that reads as "no prices". NULL plus a logged sentence keeps the observation and makes the gap
  visible. Reversible in one line the day the agreement line names its currency.
- **Clearing the other eleven houses' `USD`, as `20260903170000` cleared the timezones.** The
  argument transfers exactly — ten US houses carry a value nobody can prove was chosen — but it
  erases ten houses' currency to make a point about provenance, and the founder has not been
  asked. Filed below, not done.
- **Inheriting the house's currency onto a price when the paper states none.** This is the defect
  wearing a helpful face. On the Fethiye house it would have written USD.
- **A currency-conversion rate, anywhere.** No source, no date, no issuer — every requirement
  this ADR puts on a price, a rate fails.
- **A country-to-currency table in the gateway as well as the web.** Two tables of the same fact
  rot apart. The gateway validates SHAPE only (`/^[A-Z]{3}$/`); the codes a manager can choose
  come from the one table, in a select, so "TL" and "$" cannot be typed in.

### Founder-only questions raised by this pass

> Numbering note (2026-09-05): this section's founder questions are **Q30-Q35**. Q13-Q16 belong
> to the size reader, Q17-Q21 to Michigan/Illinois, Q22-Q25 to Türkiye/UK and Q26-Q29 to the
> merchant-shop sweep; Q29 was the highest in the file when these were written. Q30, Q31 and
> Q33 were answered by the founder the same afternoon and built; Q34 and Q35 were raised by
> that build.

30. ~~**Clear the other eleven houses' `USD` too?**~~ **ANSWERED 2026-09-05**, founder:
    *"Clear all eleven to unrecorded; the onboarding step asks"*. Built as a second mode on the
    correction script, `--clear-inherited`, dry by default and refusing `--apply` without the
    founder's-word flag. Eleven rows qualify; the three corrected earlier the same day carry
    codes the default never supplied and are left alone. **It erases real answers with the
    fabricated ones** — ten of the eleven are American and `USD` is probably right for them —
    and that is the decision, on the same argument
    `20260903170000_a_default_is_not_an_answer.sql` made for three other columns.
31. ~~**Should the agreement line carry a currency column?**~~ **ANSWERED 2026-09-05**, founder:
    *"A currency column on the agreement line, defaulted from the vendor's terms or the house,
    stated on the sheet"*. `procurement_order_items.currency`, nullable with no default and an
    ISO 4217 CHECK (`20260905200000_the_agreement_names_its_money.sql`). **One correction to the
    sentence, measured rather than assumed:** `restaurant_vendor_terms` has seven columns and
    none of them is a currency, so "the vendor's terms" has no field to read. The chain reads
    the vendor's own PAPER instead — the currency on their most recent
    `procurement_documents` row, by the document's own date — then the house, then nothing.
    That is better evidence than a typed preference and it already exists in production.
    Whether a typed term-currency should exist as well is Q34.
32. **Who sends the invoice's currency on `verifyReceipt`?** STILL OPEN. The DTO accepts
    `invoiceCurrency` and the receiving screen does not send it, so a verified receipt records
    NOTHING for currency today. The document header already holds the real code
    (`procurement_documents.currency`, two live `TRY` rows). One field on the receiving form, or
    one read of the linked document. The confirm path no longer has this problem — Q31 gave it a
    column — so receiving is now the only price writer with no currency to read.
33. ~~**The country tables disagree.**~~ **ANSWERED 2026-09-05**, founder: *"One country table
    keyed by ISO code, every surface reads it"*. `apps/web/src/lib/countries.ts` is now 194 rows
    keyed by ISO 3166-1 alpha-2, each with a display name, the currency where this file can
    state it, and every spelling anybody has actually sent as an alias. `PlacesAutocomplete`'s
    `COUNTRY_ISO` and `lib/currency.ts`'s `COUNTRY_CURRENCY` are deleted, and
    `countries.migration.test.ts` freezes all three retired tables verbatim and asserts every
    pair still resolves — the retirement is proved, not trusted.
34. **Should `restaurant_vendor_terms` carry a currency the desk can type?** Q31's chain reads
    the vendor's invoices because the terms table has no such column. A typed one would let a
    house state "this vendor bills us in EUR" before the first invoice arrives — which is
    exactly the case a new vendor is in. It is a column, a form field, a DTO and an audit row,
    and none of that was asked for, so it was not built.
35. **Nothing lets a house CHANGE its currency after sign-up.** The step asks once, on the
    sign-up form. After Q30 clears eleven houses to NULL, every one of them needs somewhere to
    answer — and `/settings` renders the state without offering to set it. That is a hole the
    clearing pass opens, and it is the first thing to build after the apply.

## Michigan and Illinois: the best honest line (2026-09-05)

The founder, asked how the index box should read for the six houses in these two states, was
offered three options — a sentence naming why, per state; an em dash with the reason in a
tooltip; a human-fetch path for Michigan — and chose none of them: *"research deep and
validate, deploy agents for deep analysis (opus). deploy agent(sonnet) to review. do the best
option"*. This section is the evidence, and the answer the evidence gives is **different for
the two states**, which is itself the finding: one option was never going to fit both.

Every fetch below was made today with the identifying User-Agent
`MudavymPriceSightings/0.1 (+https://mudavym.com/bot; …)`. No browser User-Agent was sent and
no block was routed around. The full transcript — URL, UTC time, status line, response headers
and the first 200 bytes of every body — is `p4ac-fetch-log.md` in the session scratch.

### Michigan: the block is real, narrower than recorded, and the book is better than recorded

**Three corrections to this ADR's own Michigan record, all measured.**

1. **The block is host-specific, not state-wide.** `www.michigan.gov` answers **403** with
   `server: AkamaiGHost` on the price-book page, on a direct PDF (`5-3-26-PRICE-BOOK-PDF.pdf`)
   and on `robots.txt` itself, every reference sharing one edge-config hash
   (`18.6353d117.*`), so the deny is host-wide rather than path-specific. `dig` names the
   product: `www.michigan.gov` -> `edgekey.michigan.gov` -> **`e4514.ksd.akamaiedge.net`** —
   `ksd` is Akamai **Kona Site Defender**. The body is a static "Access Denied" page: no
   captcha, no JavaScript challenge, no `Retry-After`. `www.legislature.mi.gov` answers 403
   from a different WAF. But **`ars.apps.lara.state.mi.us`** — LARA's own Administrative Rules
   site, behind Cloudflare — serves this fetcher normally (200, 130,880 bytes). Michigan does
   not refuse us; one Michigan host does.
2. **`data.michigan.gov` is not a way round it, and the reason is robots, not a WAF.** The
   state runs a Socrata portal there (`X-Socrata-Region: aws-us-east-1-fedramp-prod`) which
   answers this fetcher with **HTTP 200** and then publishes, under `User-agent: *`,
   **`Disallow: /`**. Nothing on that host was read beyond `robots.txt`. So even if the price
   book were ever loaded there as a dataset, this repository may not fetch it. That is a
   stronger and more permanent bar than the Akamai 403, and it had not been recorded.
3. **"No honest sample exists to parse" stopped being true.** The Commission publishes every
   artefact as **`.xlsx` as well as `.pdf`** — the archived issuer page lists
   `PRICE-BOOK-EXCEL.xlsx`, `NEW-ITEM-PRICE-LIST-EXCEL.xlsx`, `RETAIL-PRICE-CHANGES-EXCEL.xlsx`,
   `ADA-CHANGES-EXCEL.xlsx`, `PRODUCTS-FROM-MI-MANUFACTURER-EXCEL.xlsx`. An `.xlsx` is a
   deterministic parse target; a PDF is not. A real edition was obtained and measured (below).

**The cadence in the registry was wrong, and wrong in the dangerous direction.** It read
`monthly (spirits price book)` / `maxAgeDays: 62`. Measured from 125 archived captures, grouped
by artefact and differenced: the **PRICE-BOOK moves every 91 days** (14 editions 2022-01-30 to
2025-11-02; 8 of 13 gaps exactly 91, the two 182s being missed captures; the 2026 editions are
2026-02-01, 2026-05-03, 2026-08-02 — 91 and 91), while the **NEW ITEM PRICE LIST moves every 28
days** (34 editions; modal gap 28, then 35). The four-weekly series that made the book look
monthly is a different artefact. A 62-day bound refuses a perfectly current price book from day
63 of its own cycle. Corrected to `quarterly (the price book moves every 91 days)` /
`maxAgeDays: 105`.

**The book prices exactly what a Michigan house buys.** The issuer's own column page defines
the columns, verbatim: `BASE PRICE` is "what the State of Michigan paid for the liquor
(including the Federal Excise Tax), plus a 65% markup"; **`LICENSEE PRICE` is "the price paid by
licensees… includes the 17% licensee discount and the specific taxes of 4% + 4% + 4%"**;
`MINIMUM SHELF PRICE` is retail. `SIZE IN ML` and `PACK SIZE` are published on every row. So the
licensee price is a genuine **class-B posted wholesale price** for the three Michigan houses,
and ADR 0117's unit and pack requirements are met by the source itself rather than inferred.

**The file is the cleanest this register has measured.** One real edition (2025-08-03,
804,270 bytes, sha256 `ff592f82…`) read in full with a stdlib `zipfile` + `ElementTree` reader,
so the measurement does not depend on the library the gateway uses: 12,795 rows — 3 header, 1
blank, 261 category headings, **12,530 product rows** — and **zero** defects on every test that
caught defects elsewhere. No missing size, no missing pack, no missing licensee price, no
licensee above base, no shelf below licensee, **no duplicate item codes at all** (Iowa published
2,308). `LICENSEE/BASE` sits in a tight band, median 0.949944, min 0.9194, max 0.9773 — the
Commission rounds each step of its own stated arithmetic rather than applying one factor, which
is why the parser checks the measured band and never the formula.

**Michigan's beer and wine ARE posted — and are not published.** The brief assumed Michigan
posts no wholesale beer or wine prices. It does, quarterly, and the distinction is the whole
answer. `Mich. Admin. Code R. 436.1726`: a manufacturer or wholesaler "shall **file with the
commission in Lansing**, before January 1, April 1, July 1, and October 1 of each year, a
schedule of the net cash prices to retail licensees for all wine by kind, type, size, and
brand", held for the quarter. `R. 436.1625` says the same for case and keg beer, with price
reductions held 180 days. **Neither rule requires publication.** The verb is "file with the
commission" in both. So a Michigan wine house's honest line is not "Michigan posts no wine
prices" — it is that the schedules exist, the state holds them, and only a FOIA request reaches
them. That is a different sentence and a different (unbuilt) path.

**Everything else in Michigan is class C or worse.** `imperialbeverage.com` (robots: everything
allowed) serves 4,105 visible characters with **no dollar amount** and three login doors;
`greatlakeswineandspirits.com` serves a JavaScript shell; `rndc-usa.com` is a corporate site.
`liquorli.st` republishes Michigan prices and disqualifies itself twice over in its own words:
it shows "Michigan's **minimum retail shelf price**" — the retail column, not the licensee one —
and states it "is not affiliated with or endorsed by the Michigan Liquor Control Commission",
so its provenance is a third party's scrape, which fails this ADR's issuer test exactly as the
Connecticut intermediary does.

### Illinois: there is nothing to fetch, and that is a fact about the state

Three primary sources, all read today, all agreeing:

- **235 ILCS 5/6-19, in full:** "Sec. 6-19. (Repealed). (Source: P.A. 82-783. **Repealed by
  P.A. 90-432, eff. 1-1-98.**)"
- **11 Ill. Adm. Code 100** — the Commission's own rules — read whole (216,637 bytes, 2,148
  text lines): **53 distinct section headings, none containing "price", "posting" or
  "schedule"**, and all 16 body occurrences of "price" are trade-practice rules (a uniform
  admission price, inducements, quantity discounts, a ban on an industry member affixing prices
  for a retailer).
- **Article VI of the Act**: across the whole article the only "schedule of the prices" is
  235 ILCS 5/6-28, *happy hours* — a retailer's own drink list at its own bar.

The ILCC's own Statutes and Rules page links to the Act and two administrative codes and
nothing else: no price file, no posting page, no lookup. Illinois state hosts do **not** block
us (`ilcc.illinois.gov` has no `robots.txt` and served us; `tax.illinois.gov` served us) —
there is simply nothing there. Every Illinois distributor is per-account: `breakthrubev.com`
publishes `Allow: /` and serves us 107,889 bytes containing **no dollar amount at all**, only
"Partner Portal" and "Customers Order Here". The obvious class-D retail reference, **Binny's**,
publishes a permissive `robots.txt` that even advertises a sitemap — and its server answers
**403 with a Cloudflare challenge** on the sitemap and on the home page alike.

The one public, dated, issuer-stamped Illinois number is the **tax**: the Illinois Department
of Revenue's Liquor Gallonage Tax, in force for reporting periods July 2026 or after — $0.231
per gallon for beer/cider 0.5-7% ABV, $1.39 up to 20%, **$8.55 above 20%**. `www.chicago.gov`
answers **403 `AkamaiGHost`** — the same shape as michigan.gov — so **Chicago's own liquor-tax
rate is unverified**; the city's third-party code publisher disallows `ClaudeBot` in
`robots.txt` and reserves `ai-train`, and was not fetched.

### The option chosen, and why it is two options

**Michigan gets the human-fetch path. Illinois gets the sentence.** Neither state's answer works
for the other, and forcing one shape on both is what made the old box wrong in two different
ways at once.

For **Michigan** a sentence alone would be a lie of omission. The Commission publishes the exact
number the house pays, in a machine-readable file, updated quarterly; a browser driven by a
person downloads it in one click. Telling a Michigan house "this cannot be fetched" and stopping
there hides a fix its own manager could apply in a minute. The em-dash-with-tooltip option is
worse than either: it hides the most useful thing this register knows about its best-matched
jurisdiction behind a hover.

For **Illinois** the human-fetch path has nothing to carry — no file exists — and an em dash
says nothing at all. What Illinois needs is the *cause*, which is permanent, statutory, and
useful: it tells the house to stop waiting and tells it where the answer actually lives (its own
invoices, and a declared distributor connection).

**What was built.**

- `apps/api-gateway/src/price-index/parse-michigan.ts` — the class-B parser, emitting the
  LICENSEE price with the issuer's own definition as `price_basis`, base and shelf kept on
  `raw` and never emitted. Refusals: `no_size` (never assumed to be 750 ml), `bad_pack`,
  `no_licensee_price`, `licensee_price_out_of_band`, `shelf_below_licensee`,
  `duplicate_liquor_code`, `no_brand`, `no_liquor_code`, and `not_a_product_row` for the
  header, category and spacer rows — counted, never silently dropped.
- **`readEditionDate` and the reason it is load-bearing.** Measured on the real workbook: **no
  cell carries an effective date** and `docProps` holds only the authoring day. The edition date
  lives in the file name and nowhere else. So the date is read from the name, a future or
  impossible date is refused, and a file that states none is refused **before a row is parsed**.
  Nothing is ever dated by the upload clock.
- `michigan-workbook.ts` — the `exceljs` adapter. **`exceljs` was already a gateway dependency**
  (`menus/parsers/csv-parser.service.ts`), so no dependency was added, and the base64-in-JSON
  upload shape already existed in this gateway.
- `price-index-upload.service.ts` + `POST /price-index/upload` — owner/manager, **dry run by
  default**, `commit: true` additionally requiring `PRICE_INDEX_UPLOAD_ENABLED` (the same
  allow-list predicate as the fetch, imported rather than re-implemented). The staleness gate
  stands before any write. `raw.upload` carries the file name, the sha256 of the exact bytes,
  the user id, the upload time and `editionDateFrom: "file_name"`.
- `silence-notes.ts` — the per-jurisdiction sentence, with its primary sources on the record,
  and the distinction between a **settled** jurisdiction and an **unresearched** one.
- The registry's Michigan entry: corrected cadence and bound, the fixture, `intake: "upload"`,
  and a `withheld.reason` narrowed to *why no machine can read it*. It deliberately keeps **no
  `parse`**, so the scheduled sweep's own `withheld || !parse` guard means nothing here will
  ever fetch michigan.gov.

**Measured before and after, against a copy of HEAD** (`git show
HEAD:apps/api-gateway/src/price-index/price-index.service.ts` into a same-depth probe, run, then
deleted — no git state change). For `US-IL`, HEAD returns:

> "No posted list or public index is known for US-IL. A house here has no index line until one
> is found."

Illinois' price-filing section was repealed twenty-eight years ago. "Until one is found" reports
a settled legal fact as a pending search — the same shape as reporting an absence as health. It
now returns the researched sentence naming the statute, the repeal, the rules and where the
answer actually lives. A jurisdiction nobody has researched now says *that*, rather than
borrowing Illinois' certainty.

**What was NOT built, and why.**

- **No fetcher for Michigan, and none is possible.** No S3, CDN, FTP, legislature or ADA mirror
  exists; the open-data portal forbids it in `robots.txt`. Nothing here fetches michigan.gov or
  the archive on any schedule.
- **No FOIA path for the beer and wine schedules.** They exist and the Commission holds them.
  Building a request workflow is a different piece of work and needs the founder's answer to
  Q19.
- **No web surface for the upload.** The endpoint returns everything the panel needs to say
  "this book is yours, brought in on this date by this person" — drawing it is web work this
  session did not do, so a Michigan manager cannot yet reach the route from the product.
- **No migration**, so the uploader's identity lives in `raw` rather than a column of its own
  (Q17).
- **No Chicago or Cook County tax line.** Chicago's rate is unverified and the derived-tax-line
  fork is already open as Q9.

### Founder-only questions

17. **Should who-uploaded-it be a column rather than a key in `raw`?** Today the person, the
    file name and the sha256 live in `price_index_postings.raw.upload`, because this session was
    not authorised to add a migration. A JSONB key is not queryable the way a column is, and
    "which manager's upload put this number on the screen" is exactly the question someone will
    ask after a bad book. Add `uploaded_by`, `upload_file_name`, `upload_sha256`?

    **ANSWERED by the founder, 2026-09-05: *"Promote them to columns on the postings row."*
    BUILT the same day; Q17 is CLOSED.**
    `supabase/migrations/20260905160000_an_uploaded_book_names_who_carried_it.sql` adds four
    nullable columns with no DEFAULT: `uploaded_by` (**FK to `public.users(user_id)` — never
    `auth.users`, which is a disjoint table whose ids would 23503 on every real write while CI
    stayed green**, so the migration asserts the FK's target schema in its own `DO` block),
    `upload_file_name`, `upload_sha256` (hex CHECK) and `upload_edition_date`. A partial index on
    `(uploaded_by, issued_at DESC)` answers the question the founder asked in one seek.

    **All four or none.** `price_index_postings_upload_provenance_complete` admits only
    all-four-NULL (every fetched row, and every row written before the migration) or
    all-four-NOT-NULL. A row carrying a file name and no uploader is worse than a row carrying
    neither: it *looks* provenanced. The migration proves the CHECK refuses one rather than
    trusting it was created, by attempting exactly that insert and requiring a `check_violation`.

    **Why `upload_edition_date` is not a duplicate of `issued_at`.** Measured on the real
    workbook: no cell in the sheet carries an effective date, and `docProps` holds only the
    authoring day. The edition date exists in the FILE NAME and nowhere else — so `issued_at` on
    an uploaded row is a value read out of a string a person could have renamed. The two are
    equal at write time and are not the same *fact*: one is the register's date for the row, the
    other is the evidence that date came from, and it survives any later correction.

    **The JSONB copy stays**, carrying `fileBytes`, `sheetName`, `uploadedAt` and
    `editionDateFrom` — none of them promoted. A column added later must never silently delete
    the evidence that predates it.

    The writer sets all four with **explicit keys**, never a conditional spread; the read path
    returns them on every index line (`uploadedBy`, `uploadFileName`, `uploadSha256`,
    `uploadEditionDate`) so a panel can say *"from the book <name> brought in on <date>"* and
    never half of it. A commit that names no person is **refused with a sentence** rather than
    left to fail as a database 500 — and refused last, so a dry run may still name nobody.
    Measured against a `git show HEAD:` copy of the writer in a same-depth probe, since deleted:
    the same upload produced **0 of 4 columns before and 4 of 4 after**, with the same facts
    reachable before only by scanning JSONB.

    **The migration's in-file assertions are UNEXECUTED: Docker is down in this environment, so
    no local Postgres could apply it.** The SQL is asserted by tests that read the file
    (`upload-provenance-columns.spec.ts`) — the FK target, the all-or-nothing CHECK, the absence
    of a DEFAULT and of any RLS or GRANT statement — which is not the same thing as running it.
18. **A doctored workbook is undetectable, and that is not fixable by code.** The MLCC publishes
    no signature. The defence is provenance — the row names the person and the sha256 lets anyone
    re-download the same edition and compare byte for byte — plus the fact that an uploaded line
    is class B in its own register and is never compared with a vendor quote. Is provenance
    enough, or should an uploaded book require a second person's confirmation before it is shown?
19. **Michigan's beer and wine schedules are filed with the Commission, not published. Open a
    FOIA request?** R. 436.1625 and R. 436.1726 make every wholesaler file net cash prices to
    retail licensees. Those are public records. A standing quarterly FOIA request would give the
    Michigan houses a wine and beer posted list that exists nowhere else — at the cost of a
    manual, correspondence-based intake with no cadence guarantee. Worth pursuing?

    **THE PREMISE OF THIS QUESTION IS WRONG, and the correction is dated here rather than
    rewritten over it (2026-09-05, later the same day; ADR 0126).** ~~"Those are public
    records."~~ **MCL 436.1609a** — read verbatim on `codes.findlaw.com`, HTTP 200, after
    `legislature.mi.gov` answered 403 to `curl` and failed TLS verification to the harness
    fetcher — provides that "a net cash price filed under subsection (1) and a price change
    filed under subsection (2) are **exempt from disclosure** under section 13 of the freedom of
    information act, 1976 PA 442, MCL 15.243, **until 1 year after** the net cash price or price
    change is filed", with the same exemption stated for the wine filings. So a standing
    quarterly request cannot produce "a wine and beer posted list"; it produces a rolling
    **twelve-month-lagged** series. Also corrected, from the rules themselves
    (`law.cornell.edu`, HTTP 200): the quarterly cadence is **wine's** alone — R 436.1726(1),
    filed "before January 1, April 1, July 1, and October 1 of each year" — and **beer has no
    recurring filing date**; R 436.1625 requires a schedule and requires a reduction to be filed
    before its effective date and held "at least 180 days". The register now holds
    `michigan-lcc-filed-beer-wine-schedules` (`intake: "foia"`, `status: "not_yet_filed"`,
    `maxAgeDays: 480` documented as the embargo's arithmetic and not a freshness allowance), and
    the request is drafted for the FOUNDER at
    `.planning/07-reference/MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md`. **Nothing has been sent.**
    The question the founder now faces is ADR 0126 Q2: is a twelve-month-lagged wine and beer
    series worth a quarterly correspondence cycle?
20. **Illinois' honest answer is "declare your distributor".** Nothing public exists, and
    Breakthru, Southern Glazer's and RNDC all price per account behind a login. That makes class C
    the only route to a real Illinois number. `/connections` (ADR 0114) would need a distributor
    connection type per house with credentials the house owns. Is that the next build for the
    three Illinois houses, or do they stay on their own invoices?

    **RESEARCHED 2026-09-05, and there is no feed to declare (ADR 0126).** ~~"That makes class C
    the only route to a real Illinois number."~~ A login is not a feed, and both of the two
    distributors whose terms were read forbid the mirror in their own words:
    `now.breakthrubev.com/robots.txt` publishes `User-agent: *` / `Allow: /bbg/en/login` /
    `Disallow: /`; Breakthru's Terms §6.2(c) forbid "web crawlers, data mining, scraping, robots,
    spiders"; and Southern Glazer's Terms forbid "any robot, spider, or other automatic device"
    **and, separately, providing "any other person with access to this Website … using your
    username, password, or other security information"** — so declaring a portal login to this
    product is itself the breach. **This ADR's own class-C registry row is also corrected:**
    LibDib's public OpenAPI was read in full (HTTP 200, 70,801 B, 52 paths, 49 schemas) and the
    string `price` appears **zero** times, so "the most promising class-C connection" was read
    from a Swagger page's existence rather than from the document. And the industry ships
    invoices, not catalogues: Southern Glazer's documented EDI set on two independent
    trading-partner pages is 850/856/810(/997) with **no 832**; Restaurant365 ticks Multi-Invoice
    and leaves Order Guides **blank** for all three wine-and-spirits distributors it lists; and
    MarginEdge says it outright — *"We update your order guides based on your invoices."* So the
    answer to this question, on the evidence, is the second half of it: **they stay on their own
    invoices**, which is this ADR's class A and already built. The founder's call on whether to
    build the mirror anyway, with the clauses in front of him, is ADR 0126 Q1.
21. **The archive was used for the fixture. Is that acceptable, and where is the line?** The
    parser is written against a real MLCC workbook obtained from an Internet Archive capture of
    michigan.gov, because the origin refuses this fetcher. No browser User-Agent was sent, nothing
    fetches the archive on a schedule, and the fixture is thirteen months old so it can only ever
    prove a shape. It is still content the origin denied us. Recorded rather than assumed.

    **ANSWERED by the founder, 2026-09-05: *"Acceptable for shape only, labelled; never for a
    price line."* Q21 is CLOSED**, and the label is now in all three places a reader could look:
    the fixture's own `_note`, `__fixtures__/MICHIGAN-PROVENANCE.md` (a new section stating what
    it is for and what it may never do), and the registry entry beside `fixture:`.

    **How the upload path actually distinguishes a real book from the fixture — measured, and
    honestly only one of the two barriers holds.** (1) The fixture on disk is JSON, not a
    workbook, so `michiganRowsFromWorkbook` cannot open it. Real, but weak: anyone can rebuild an
    `.xlsx` from those rows in four lines, and this repository's own tests do. (2) **The edition
    date, which is the one that holds.** The file name states 2025-08-03 against a 105-day bound:
    **398 days stale on the day it was recorded, 763 a year later**, and monotonically worse.
    There is no clock at which the gate admits it — asserted at 2026, 2027, 2030 and 2099 in
    `michigan-fixture-not-a-price.spec.ts`, together with the boundary (it would have passed on
    2025-11-16 and not on 2025-11-17). **There is no third barrier**, and the tests do not
    pretend otherwise: the fixture is not blocked because it is *the fixture*, it is blocked
    because it is *old*. That is a stronger guarantee than an identity check, which would compare
    a sha256 that changes the moment anyone re-serialises the rows.

## The sweep that reads merchant shops (2026-09-05)

> Numbering note (2026-09-05): this section's founder questions are **Q26–Q29**; the size reader holds Q13–Q16, Michigan/Illinois Q17–Q21, Türkiye/UK Q22–Q25. Each was first numbered by its own builder in a shared file; the parent renumbered so every question in this ADR has one number.

The founder's call, in full: **"Point it at merchant shops, as their own class,
and clean the three websites."** This section is the first half; Q13 above is
the second. Code: `apps/api-gateway/src/vendor-intel/price-reference-shops.ts`,
`shop-reference-posting.ts`, `shop-reference-sweep.ts`,
`shop-reference-sweep.service.ts`, and the two specs beside them.

### The register, and why the separation is structural rather than a check

A merchant's shelf price is **class D**. This ADR's table says class D may be
compared only to other class-D lines and may **never** be placed beside a
vendor quote, and ADR 0111 says it renders as its own line. So the shop sweep
writes to `price_index_postings`, not to `vendor_price_observations`.

That is not a preference; it is the only register the row can honestly enter.
`vendor_price_observations.restaurant_id` is NOT NULL and
`belowTrailingAverage` reads `restaurant_id.is.null OR restaurant_id.eq.<tenant>`
(`vendor-comparison.service.ts:341`), so a jurisdiction-scoped row there would
have to either pretend to be one house's own sighting or be visible to every
house on the platform — the same objection that demoted the Iowa load.
`price_index_postings` was built for exactly this: keyed by `state`, no
`restaurant_id` at all, `source_class` CHECKed to `retail_reference` among the
three. **The ladder reads the other table**, so a shelf price cannot reach it
even by mistake; there is no flag to forget and no class check to get wrong.

### The shop registry is a config file, not a `price_reference_shops` table

The brief allowed either and asked for the decision on evidence. Five things
decided it, and the counter-argument is recorded with them.

1. **The sibling register already answers this question in code.**
   `price-index.registry.ts` holds every class-B/D/E source with its issuer,
   jurisdiction, cadence, terms and a `withheld`/`silent` record carrying
   `measuredOn`. A shop is the same kind of entry, and two registries for one
   register would be two answers to "where does a source come from".
2. **A shop row's content is the evidence of a fetch**, not configuration: the
   robots status, the day it was read, the crawl delay, the visit window,
   whether the shop states a date on its prices. That belongs where it is
   reviewed and where `git blame` says who claimed it.
3. **Arming a shop starts outbound requests in the house's name.**
   `isSweepArmed`'s docblock already argues that a job with that property must
   not be switchable without a deploy; a boolean column would let anyone with
   `service_role` arm a crawler with no review.
4. **A seeded table is a production write executed by a merge.** Migrations
   auto-apply on merge here, so seeding shops by migration would move the
   decision to point at a particular shop out of the founder's hands and into a
   squash-merge.
5. **Cost.** A table needs a migration, RLS, two guards and a CRUD surface
   nobody asked for.

**The counter-argument, which is real:** an operator cannot add a shop without a
deploy, and no house can keep its own shop list. Neither costs anything today —
the register has deliberately no `restaurant_id`, so a per-house list has
nowhere to live, and a shop may not be added until a fetch has proved its terms,
which is research rather than a settings change. **The trigger to revisit is
recorded in the file itself:** the day a non-engineer must add shops at will,
this file becomes the seed for a table.

### Which markets the estate needs, and what each one actually got

Coverage read from `price-sources.md`'s own measurement of `restaurants`
(14 houses: 3 Michigan, 3 Illinois, 3 California, 2 Türkiye, 1 UK, 2 with no
state). Every row below was measured on **2026-09-05** with the sweep's own
agent, one request per host.

| Market | Houses | Shop measured | robots.txt | Verdict |
|---|---|---|---|---|
| GB-ENG | 1 | Berry Bros. & Rudd | 200, 1,502 B, `Crawl-delay: 10`, **`Visit-time: 0200-0700`** | armed |
| GB-ENG | — | Slurp, Tanners, Hedonism | 200, Shopify storefront files, `/products/` allowed | Slurp + Tanners armed; **Hedonism refused on currency** |
| US-CA | 3 | Hi-Time Wine Cellars | 200, 1,674 B, `Crawl-delay: 10` | **armed** — and its price is in microdata + Open Graph, not JSON-LD |
| US-CA | — | K&L Wine Merchants | **403 to robots.txt itself** (5,606 B challenge) | unarmed: its crawl rules are unknown, so nothing may be fetched |
| US-IL | 3 | Binny's Beverage Depot | 200, 297 B, product pages allowed — **and the sitemap it advertises answered 403** (Cloudflare, 4,574 B) | unarmed: a fact about our fetcher |
| US-MI | 3 | Merchant's Fine Wine | 200, 1,248 B — **24 lines, every one a comment**: the Cloudflare content-signals preamble with **no signal stated** | unarmed: its own rule (c) says permission is neither granted nor restricted |
| TR | 2 | Kavaklıdere | 200, 293 B; `*` allowed, `GPTBot`/`CCBot`/`Google-Extended` disallowed by name | unarmed: the homepage is 170,717 B with **zero** occurrences of the lira sign, "TL", "fiyat" or a cart |
| US-NJ | 0 | Wine Chateau | 200, Shopify storefront file | unarmed: **serves no house** — the register scopes by state at read time |

**The finding is the same asymmetry this ADR keeps meeting, one layer down.**
The market with a working merchant shop has **one** house; the three markets
with nine houses between them have none that may be fetched today, and each for
a different reason — a challenge page, an unstated term, and a statute. Türkiye
is not a fetcher problem: Law 4250 art. 6 and the sales regulation md. 11/1 make
consumer-facing online alcohol sale unlawful (recorded here as unverified at
primary source — see `price-sources.md`), so there is no Turkish shelf price to
read, and the measured silence is what that predicts.

### How a price is read, and why in that order

The vendor sweep sends page text to a model because a wholesaler's page is
prose. A merchant shop is a commerce platform and publishes its price as data,
so this reader reads the markup: deterministic, no tokens, testable against a
recorded file, and unable to hallucinate a number. It is also the only way to
see the price at all — `htmlToText` drops `<script>`, which is where the offer
lives, the same finding that drove the size reader.

1. **schema.org `Offer` inside a `Product` node.** The merchant's own machine
   statement, the only one carrying `priceCurrency`, and the only one that ever
   carries a date. Present on **6 of 6** recorded fixture pages.
2. **Microdata `itemprop="price"`.** The same statement inline. It is the ONLY
   machine-readable price on Hi-Time, whose single JSON-LD block is a
   `BreadcrumbList` — measured 2026-09-05 on `/pommery-brut-royal-354430`:
   `itemprop="price" content="54.99"`, `product:price:amount` 54.99,
   `product:price:currency` USD, `og:price:standard_amount` 59.95.
3. **Open Graph, last**, because a share tag is written for a scraper and
   drifts. The Wine Chateau page publishes **three** `og:title` values and the
   FIRST is the shop's own slogan, *"Buy Wine Online - WineChateau® for Fine
   Wines"*. Reading the first refused a perfectly well-formed page, so the
   page's claim about itself is the **set** of titles it publishes and a
   product node matching any of them is accepted.

The **size** is not re-implemented: `readBottleSize` is imported. A second
answer to "how big is this bottle" is a second answer.

### What is refused, and the measurement on the six recorded pages

Run on the tree this section describes, with
`npx jest --silent=false src/vendor-intel/shop-reference-posting.spec.ts`; the
test prints the table so the numbers here are reproducible from one command.

```
  bbr-cremant-de-limoux-2026-09-04.fixture.html  REFUSED  no_issue_date
  bbr-dom-perignon-2026-09-04.fixture.html       REFUSED  identity_conflict
  slurp-pellehaut-rose-2026-09-04.fixture.html   REFUSED  no_issue_date
  tanners-andre-clouet-2026-09-04.fixture.html   ADMITTED 35 GBP 750ml via json_ld_offer, issued 2026-09-05
  hedonism-ruinart-2026-09-04.fixture.html       REFUSED  currency_not_jurisdiction
  winechateau-caymus-1l-2026-09-04.fixture.html  REFUSED  no_issue_date
    admitted 1/6
```

**One admitted, five refused, and every refusal is a different real fault.**

* `identity_conflict` — the Dom Pérignon page whose only JSON-LD block is
  **Caol Ila 25-Year-Old whisky at GBP 225**. A reader that trusted structured
  data because it is structured would file GBP 225 as the champagne's price.
  The Open Graph price is deliberately NOT used as a fallback there: a page
  whose machine data is about another product has not earned trust in the rest.
* `currency_not_jurisdiction` — Hedonism, a London shop, serves
  `priceCurrency: USD` (and `og:price:currency: USD`) to an anonymous fetcher.
  A USD figure on a GB index line is not the UK shelf price, and putting it
  beside GBP lines is the comparison this ADR exists to prevent.
* `no_issue_date`, **three of six, and the important one.** ADR 0117 admits a
  row only if it names when the price was published;
  `price_index_postings.issued_at` is documented as *"the ISSUER's own
  effective/publication date, never the fetch date"* and `refuseStale` reads
  that column as the freshness signal. Of the six pages, exactly **one** states
  `Offer.validFrom` (Tanners, 2026-09-05, with `priceValidUntil` 2026-12-04).
  Slurp states only `priceValidUntil` — and publishes it as `"2027-09-5"`, a
  single-digit day, which is why the reader parses the value instead of
  shape-testing it. **The five undated pages are refused rather than stamped
  with our own clock**, because a row dated by our fetch is fresh by
  construction and would make the staleness gate vacuous for the entire class.
  Whether a shop price may instead be filed with a read-date basis is the
  founder's call, not a default taken here: **Q27**.

`price_conflict` and the remaining refusals are pinned by unit cases rather than
by a fixture, since no recorded page exhibited them — stated so the difference
between "measured" and "designed for" is visible. The Wine Chateau bourbon page
fetched the same day DOES exhibit it (five offers, 33.95 and 39.95 on one
product), and it was not added as a fixture: see below.

### Politeness, and one directive nobody implements

robots.txt is fetched per host and an explicit `Disallow` is honoured; the
host's own `Crawl-delay` replaces our floor whenever it is larger — both by
importing the vendor sweep's own limiter rather than writing a second one.

**And `Visit-time` is honoured, which is new.** It is not in the original robots
specification and almost nobody publishes it — and `www.bbr.com` does:
`Visit-time: 0200-0700`, beside `Request-rate: 1/10`. A publisher that states
the hours it wants to be read has told us something specific, and ignoring it
because the standard does not compel us would be choosing not to listen. The
two committed Berry Bros fixtures were fetched at **02:08Z**, inside the window;
**this session wanted to re-read that host at 11:14:35Z and did not**, which is
the case the test pins. The registry's recorded window is checked before any
request at all, so an out-of-hours host costs not even a robots probe; the live
file wins over the recorded one whenever they differ.

### What is deliberately NOT built, stated rather than left to be discovered

* **Catalogue enumeration.** A run reads the pages it is given. The register
  carries the product identity AS POSTED and has no join to a house's own
  wines, so a thousand enumerated rows would be a thousand prices nobody asked
  about, bought with a thousand requests. The permitted enumeration routes are
  recorded (Hi-Time's `/xmlsitemap.php?type=products` returned 1,154,767 bytes
  of product URLs on 2026-09-05) so whoever answers the identity question does
  not have to find them again. **Q28.**
* **A seventh fixture.** Hi-Time's page is the only measured microdata-only
  shop and it is 138,070 bytes. Q16 already asks whether 282 kB of reduced
  third-party markup should stay in the repo; adding to it while that question
  is open would be answering it by accident. The microdata and Open Graph paths
  are pinned by synthetic cases carrying the exact strings the real page
  serves, and the real page's URL, date, byte count and strings are recorded
  here and in the registry.
* **A live run.** Nothing was fetched by the gateway, no flag was armed, and
  **no row was written to any database.** Both flags default off:
  `PRICE_REFERENCE_SHOP_SWEEP_ENABLED` to run at all, and
  `PRICE_REFERENCE_SHOPS_ARMED` to name which shops may be touched.
* **A `price_reference_shops` table**, per the argument above.
* **Any change to the vendor-site sweep.** It still reads `providers`. Two
  instruments, two flags, two registers.

### Rejected alternatives

1. **Widen `vendor_price_observations` with a `jurisdiction` column** so a
   shelf price could live beside the quotes with a class label. Rejected: the
   column would be a promise that every reader honours the label, and this
   repo's standing fault is precisely a label nobody reads (`is_outlier`
   DEFAULT false, which certified every row as clean for months). The register
   split makes the ladder unable to see the row at all.
2. **File undated shop prices with `issued_at` = the fetch date plus an
   `issued_at_basis` column.** It was the obvious way to admit 5 of 6 instead
   of 1 of 6, and it is rejected as a default rather than as an idea: it
   weakens `refuseStale` for a whole class, and it decides a question the
   founder has not been asked. It is Q27, with the migration named.
3. **A model reading of the shop page**, as the vendor sweep does. Rejected on
   the measurement: the price was machine-readable on 6 of 6 pages, so a model
   would add tokens, latency and a new way to be wrong for nothing.
4. **Taking the lowest of several offers** on a multi-variant page. Rejected:
   nothing on the page says which variant a single reference line should carry,
   and a shop that lists a half-bottle beside a magnum would file the wrong
   one. Refusing names the fault; picking hides it.

### The date a shop never states, and whose clock stands in (2026-09-05)

Q27, answered: *"Yes: an `issued_at_basis` column, fetch-dated rows labelled and
aged from the read."*

**The migration.**
`supabase/migrations/20260905080000_a_posting_says_whose_date_it_carries.sql`
adds `issued_at_basis VARCHAR(16)` to `price_index_postings`, CHECKed to
`issuer_stated | fetch_date`, **nullable with no DEFAULT**. The absent default is
the point: every row written before the column existed came from a parser that
reads a publisher's own edition date, so `'issuer_stated'` would even have been
*true* — and a DEFAULT asserting a property of rows nobody has looked at is this
codebase's standing fault written into DDL. NULL means "written before a basis
was recorded", which is what separates it from a row that was judged; the same
shape as `outlier_basis`. Additive: no existing row is rewritten, no existing
CHECK altered, RLS and grants untouched. The file's `DO` block asserts the column
exists, is nullable, has no default, and that the CHECK **actually refuses** — it
attempts an insert with `issued_at_basis = 'guessed'` and fails the migration if
that succeeds, rather than trusting a constraint it has just written.

**Where the label is load-bearing.** Three places, none of them decoration:

1. **`refuseStale`** (`staleness.ts`) takes an optional `{ basis, readAt }`. A
   `fetch_date` row is aged from the READ, not from the edition it never had.
   Omitting the option keeps the old behaviour exactly, so every periodical
   caller is unchanged.
2. **The writers state it rather than inherit it.**
   `price-index-fetch.service.ts` and `price-index-upload.service.ts` write
   `'issuer_stated'` explicitly — true by construction there, because
   `refuseStale` has already refused any run whose parser could not read an
   issuer's date. The shop writer takes it from the decision. It is deliberately
   NOT a member of `PostingSighting`: it is a property of the WRITER (one reads
   publishers, one reads shops), and making it required on the type would have
   forced five parsers to restate a fact their own gate proves.
3. **The panel prints "read on", never "issued"**
   (`apps/web/src/pages/notifications/next/MarketIndexPanel.tsx`). A null basis
   gets the weaker wording too — an unknown is never upgraded by rendering. The
   same change relabels class D from *"Control-state shelf price"* to **"Retail
   reference"**, because class D stopped being only Iowa and Oregon the moment a
   merchant shop joined it, and calling a Berry Bros line a control-state price
   would be false on its face.

**Both halves proved against the pre-fix code**, by writing verbatim
`git show HEAD:` copies to same-depth probes, running them, and deleting both:

* `refuseStale`: HEAD took three arguments and ignored a fourth, so a row whose
  `issued_at` is our read date but which was last actually read **35 days ago**
  against a 7-day cadence came back `{"stale":false,"ageDays":0}` — **certified
  fresh**. After: `{"stale":true,"ageDays":35}`, reason *"nobody published a date
  for this price and we last read it 35 days ago … a read is not a
  publication"*. That is the vacuous gate, measured rather than argued.
* the panel: HEAD failed all three new cases, rendering a Berry Bros row as
  *"Control-state shelf price · GB-ENG"* with *"issued Sep 5, 2026"* — a class
  label false for a merchant, and our own read date presented as the shop's
  publication.

**The re-measurement**, same command as the first pass
(`npx jest --silent=false --runInBand src/vendor-intel/shop-reference-posting.spec.ts`):

```
  bbr-cremant-de-limoux-2026-09-04.fixture.html  ADMITTED 15.5 GBP 750ml via json_ld_offer, read on 2026-09-05 (fetch_date)
  bbr-dom-perignon-2026-09-04.fixture.html       REFUSED  identity_conflict
  slurp-pellehaut-rose-2026-09-04.fixture.html   ADMITTED 11.99 GBP 750ml via json_ld_offer, read on 2026-09-05 (fetch_date)
  tanners-andre-clouet-2026-09-04.fixture.html   ADMITTED 35 GBP 750ml via json_ld_offer, issued 2026-09-05 (issuer_stated)
  hedonism-ruinart-2026-09-04.fixture.html       REFUSED  currency_not_jurisdiction
  winechateau-caymus-1l-2026-09-04.fixture.html  ADMITTED 84.99 USD 1000ml via json_ld_offer, read on 2026-09-05 (fetch_date)
    admitted 4/6 — by date basis: {"fetch_date":3,"issuer_stated":1}
```

**1 of 6 became 4 of 6**, and all three added rows carry `fetch_date`, so not one
of them is dated as though a shop had published it. `no_issue_date` is now **0**;
the two remaining refusals are the two that were never about the date — the Dom
Pérignon page whose only JSON-LD block is Caol Ila whisky at GBP 225
(`identity_conflict`), and the London shop serving USD
(`currency_not_jurisdiction`).

**`no_issue_date` survives, narrowed.** It now means the page states no date AND
no usable read date stands in for one — reachable only when the caller's own
fetch clock is unusable, and pinned by a test that hands in `"not a time"`. A
price with no date of any kind is still not a sighting.

**What this does NOT do.** It does not touch `issued_at`'s meaning for any
periodical: Iowa, Oregon, California, Michigan and Defra still carry their
publishers' own edition dates and are still aged against them. It does not put
the basis into `content_hash` — a re-read of an unchanged shop page must dedup,
and hashing our own clock would make every re-read look like new evidence
(pinned by a test). And the migration is **unapplied and its `DO` assertions
unexecuted**: the Docker daemon was down in this session, so unlike
`20260904200000` it has not been run against a live local Postgres. Its parent
migration is unapplied on the production project too, which is why
`GET /price-index/GB-ENG` still answers *"The index register could not be read.
This is unknown, not empty."*

### Founder-only questions raised by this pass

26. **Something stamped `verified_at` on rows whose websites are a casino, a
    wine school and a clothes shop.** Measured in the dry run of 2026-09-05:
    Banfi, Henry Wine Group and Charmer all carry
    `verified_at = 2026-08-10T17:21:2x`, two months after the seed wrote them,
    while `source` is still `curated` and `source_ref` is NULL. Whatever ran
    that verification did not check the identity of the site it verified.
    Should `verified_at` be cleared for every row it touched, and should the
    thing that set it be found before it runs again?

    **Answered 2026-09-05 (batch 51) — the founder: "Clear it and find the stamper."**
    Found, measured and done the same day. The stamper was not a job: every
    `vendor_catalogue.verified_at` in production (**seventeen** rows, not the three this
    question named — read on 2026-09-05 through `/rest/v1/vendor_catalogue`) carried one
    of two values, `2026-08-10T17:21:22.275152Z` and `…:23.426939Z`, the seconds in which
    two migrations applied to production: `20260807001352_distributor_vendor_backfill.sql:32`
    (`verified_at = now()` for fifteen rows while setting Census-geocoded coordinates) and
    `20260807001552_distributor_data_quality.sql:36,52` (the same for two address fixes).
    "Verified" meant "an address got coordinates"; nothing ever checked the website, the
    name or the business, and `source_ref` was NULL on all seventeen. Cleared on the
    founder's word at 2026-09-05T20:35:56Z by `scripts/clear_vendor_catalogue_verified_at.py
    --apply --i-have-the-founders-word` (fingerprint: the two-second window, `source =
    'curated'`, `source_ref IS NULL`; **17 of 17 cleared, 0 left**, a dated sentence appended
    to `notes`; re-read: no rows match). Migration `20260906040000_a_verification_names_its_source.sql`
    adds `CHECK (verified_at IS NULL OR source_ref IS NOT NULL)` so no later migration can
    stamp a verification nobody made (PGlite `q26-verified-names-source.mjs`: 7 passed / 0
    failed — a sourceless stamp is cleared with its note, an honest one is kept, a new
    sourceless stamp is refused with 23514). Correction to this question's own text: it said
    three rows; it was every row the two migrations touched. Also found: `providers` has no
    `verified_at` column at all — a filter on it answers 400 — so the comment at
    `vendor-intel/identity.service.ts:12` naming `providers.verified_at` is wrong (queued).
27. **May a shop's price be filed with our READ date, labelled as such?** Three
    of six pages state no date at all, and the first build refused them, so the
    class delivered one row out of six.

    **ANSWERED by the founder, 2026-09-05: *"Yes: an `issued_at_basis` column,
    fetch-dated rows labelled and aged from the read."* Q27 is CLOSED and
    BUILT** — see §"The date a shop never states, and whose clock stands in"
    below for the migration, the three places the label is load-bearing, and
    the re-measurement (1 of 6 admitted became **4 of 6**).

28. **Which pages should the sweep read?** It reads the pages it is given, and
    nothing today decides which. The honest options are: a house nominates the
    wines it wants a reference for (needs a UI and a per-house list, which the
    public register deliberately cannot hold); or the sweep reads a shop's
    best-sellers collection; or the identity join to `master_wine_library` is
    built first and the register becomes searchable by wine. The third is the
    largest and the only one that makes an index line answer "what does this
    bottle cost elsewhere".

29. **Two of the four fetchable shops are unarmable for reasons that are not
    about us.** Hedonism serves USD to an anonymous fetcher and Wine Chateau
    serves a market with no house in it. Is it worth sending a presentment
    hint (a `?currency=GBP` or a locale header) to pin Hedonism to GBP, or is
    a shop that will not quote its own market's currency to an anonymous
    visitor simply not a source?~~

    **ANSWERED 2026-09-05 (batch 52) — the founder: "Not a source until it quotes GBP
    unprompted."** A price whose currency depends on what we sent is a price we
    half-made: it would be filed as the shop's own shelf price with nothing on the row
    to tell a reader that we asked for it in that currency, and the index line's whole
    claim is that the number is what the market publishes.

    **REJECTED, explicitly: sending a `?currency=GBP` hint or a locale header, recorded
    on every row.** It was the cheaper path and it fails on its own terms. The
    provenance would be honest only for as long as the recording is read — and a
    presentment-hinted figure sitting beside an unprompted one on the same GB line is
    exactly the comparison this ADR exists to prevent. It also makes our own fetch
    configuration part of the price, so the same page read by two callers is two
    different prices with no way to know which the shop would show a shopper.

    **What was built.** `ShopUnarmedReason` gains its own code
    `quotes_another_market_currency` — Hedonism had been filed under `terms_unstated`
    with a detail that opened *"Not a terms problem but a CURRENCY one"*, and a reason
    that has to apologise for itself is the wrong reason; it also made the one shop
    blocked on presentment currency uncountable against the two blocked on unread
    terms. Hedonism's row carries the founder's words, the measurement
    (`priceCurrency: USD` and `og:price:currency: USD` on
    `hedonism-ruinart-2026-09-04.fixture.html`) and the rejected path, so nobody
    re-proposes it as new. Wine Chateau keeps `serves_no_house`, with the founder's
    confirmation that it stays off until a house is in its market.

    **Every unarmed block now states its own exit.** A new required `armsWhen` field
    names the OBSERVATION that would lift the block, never a date and never an
    intention — Hedonism's is *"serves `priceCurrency: GBP` … to an ANONYMOUS fetcher
    sending no market, locale or currency hint of any kind … A GBP figure obtained by
    asking for GBP does not count"*. It exists because a block with no stated exit is a
    block somebody deletes in six months for looking stale, and it closes the trap the
    rejected path would have opened. Wine Chateau's exit is a fact about the ESTATE
    (a house recording New Jersey), so the row says plainly that nothing the shop does
    can lift it.

    **The state is printed where the state is shown.** `ShopSweepStatusRow` gains
    `unarmedReason` and `armsWhen` beside the prose `detail`, so a reader of
    `GET vendor-intel/shop-sweep/status` can COUNT shops blocked on currency and can
    see what would lift each block without opening the registry; the run notes append
    *"It arms when …"*. `armedShopKeys` already dropped any key carrying an `unarmed`
    block whatever the environment variable said — so the block is the mechanism, not
    a note about one, and a test asserts it.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (build, Q17 + Q21 on the Michigan upload) | **Q17 ANSWERED (*"Promote them to columns on the postings row"*) and CLOSED.** `supabase/migrations/20260905160000_an_uploaded_book_names_who_carried_it.sql` adds `uploaded_by` (**FK to `public.users(user_id)`, asserted in-file to point inside `public` — `auth.users` is a disjoint table whose ids would 23503 on every real write while CI stayed green**), `upload_file_name`, `upload_sha256` and `upload_edition_date`: nullable, no DEFAULT, RLS and grants untouched, a partial index on `(uploaded_by, issued_at DESC)`, and an all-or-nothing CHECK the migration **proves refuses a half-provenanced row** rather than trusting it exists. `upload_edition_date` is deliberately not a duplicate of `issued_at`: the workbook carries no date in any cell, so `issued_at` is read out of a file name a person could have renamed, and the evidence must survive a later correction. The writer sets all four with explicit keys and the read path returns them on every index line; a commit naming no person is refused with a sentence, last, so a dry run may still name nobody. The `raw.upload` copy stays, carrying the three facts not promoted. **Q21 ANSWERED (*"Acceptable for shape only, labelled; never for a price line"*) and CLOSED.** The label is in the fixture's `_note`, in `MICHIGAN-PROVENANCE.md` and beside `fixture:` in the registry. **Measured how the path actually distinguishes the fixture from a real book, and only one of the two barriers holds:** the file is JSON not a workbook (weak — the rows rebuild into an `.xlsx` in four lines), and **the edition date**, 398 days past a 105-day bound on the day it was recorded and worse every day after. Asserted stale at 2026, 2027, 2030 and 2099, with the boundary measured (passes 2025-11-16, fails 2025-11-17). There is no third barrier and the tests say so. **Proven against pre-fix code** by `git show HEAD:` into a same-depth probe, since deleted: the same upload wrote **0 of 4 provenance columns before and 4 of 4 after**. `pnpm --filter @wineops/api-gateway exec jest src/price-index` on the tree reported here: **166 passed / 17 suites**, of which 15 in 2 suites are new here; gateway `tsc --noEmit -p tsconfig.spec.json` clean; `eslint --quiet` clean on the touched files; `check_fk_targets_exist.py`, `check_read_columns_exist.py` and `check_new_tables_are_locked_down.py` all exit 0; emoji grep empty; migration prefixes unique. **The migration's in-file `DO` assertions are UNEXECUTED — Docker is down in this environment**, so it was never applied to a live Postgres; the SQL's contract is asserted only by tests that read the file. Q18 (a second person) is another builder's and untouched. |
| 2026-09-05 | Claude (build, two founder decisions on the shop sweep) | **Q13 CLOSED ENTIRELY and Q27 CLOSED AND BUILT.** (1) *"Clear it with the three"*: `www.charmer.com` moved from REPORTED ONLY to PROPOSED in `scripts/clean_vendor_catalogue_websites.py`, same statement shape and note; the REPORTED ONLY heading kept, printing "(none)". Dry run re-run on the tree reported here: **4 of 4 rows read, 4 statements proposed, nothing written**; `--self-test` passes (4 proposed / 0 reported); `--apply` without `--i-have-the-founders-word` exits **2** and writes nothing. The PARENT runs `--apply`; this session never did. (2) *"Yes: an `issued_at_basis` column, fetch-dated rows labelled and aged from the read"*: migration `20260905080000_a_posting_says_whose_date_it_carries.sql` (nullable, no DEFAULT, CHECK proven to refuse by an in-file probe insert, RLS untouched; `ls supabase/migrations | cut -c1-14 | sort | uniq -d` empty); `refuseStale` gained `{basis, readAt}` and ages a fetch-dated row from the read; both registry writers state `'issuer_stated'` explicitly; the shop reader files an undated page under the read date; `MarketIndexPanel` prints **"read on"** for `fetch_date` and for null, **"issued"** only for `issuer_stated`, and class D is relabelled **"Retail reference"**. **Both proved against `git show HEAD:` same-depth probes, since deleted**: HEAD certified a row last read 35 days ago as `{"stale":false,"ageDays":0}`, and HEAD's panel rendered a Berry Bros row as *"Control-state shelf price … issued Sep 5, 2026"*. **The six-fixture measurement went from 1 of 6 to 4 of 6**, `no_issue_date` from 3 to 0, the three new rows all `fetch_date`. `npx jest --runInBand --forceExit src/vendor-intel src/price-index` from `apps/api-gateway`: **400 passed, 28 suites**, of which **36 cases in 3 suites are mine** (`npx jest --runInBand src/vendor-intel/shop-reference src/price-index/staleness-basis`). `pnpm --filter @wineops/web exec vitest run src/pages/notifications/next`: **97 passed, 1 failed of 98**, and the failure is NOT this change — `MarketIndexPanel.tsx` was edited by another builder at 08:19:32 while this task ran, rewriting *"never placed beside, ranked against or averaged with a vendor quote"* into *"None of them is ever placed beside…"*, which breaks the pre-existing assertion at `MarketIndexPanel.test.tsx:96`. All three of the cases added here pass and all three of this change's hunks in the panel survive their edit (verified by name); the broken assertion is left for the owner of that copy, not repaired over their edit. Gateway `tsc --noEmit` and `-p tsconfig.spec.json` clean; web `tsc` shows **0 errors in my two files** (44 elsewhere, in other builders' in-flight or pre-existing files). Guards exit 0 including `check_new_tables_are_locked_down`, `check_fk_targets_exist` and `check_read_columns_exist`; emoji grep empty on my files. **The migration is UNAPPLIED and its `DO` assertions UNEXECUTED — the Docker daemon was down, so unlike `20260904200000` it was not proven against a live local Postgres.** No flag armed, no shop fetched by the gateway, no row written to any database. |
| 2026-09-05 | Claude (build, the sweep reads merchant shops) | **The founder's call — *"Point it at merchant shops, as their own class, and clean the three websites"* — is BUILT.** Q14 CLOSED by a SECOND instrument (`shop-reference-posting.ts`, `shop-reference-sweep.ts`, `shop-reference-sweep.service.ts`, `price-reference-shops.ts`, `GET/POST vendor-intel/shop-sweep/*`), writing class D to `price_index_postings` and never to `vendor_price_observations` — the ladder reads the other table, so the separation is structural. The shop registry is a **config file, not a table**, on five recorded grounds, with the counter-argument and the trigger to revisit written into the file. **Nine hosts measured 2026-09-05**, one request each: four GB shops readable; Hi-Time (US-CA) readable and its price is microdata + Open Graph with **no** `Product` JSON-LD; K&L 403 at robots.txt itself; Binny's advertised sitemap 403; Merchant's Fine Wine publishes 24 lines of comment and **no content signal**; Kavaklıdere's homepage carries zero price signals. **`www.bbr.com` publishes `Visit-time: 0200-0700`** — honoured, and this session refused to re-fetch that host at 11:14:35Z. Measured on the six recorded pages: **1 admitted, 5 refused** — 3 `no_issue_date`, 1 `identity_conflict` (the Caol Ila block on the Dom Pérignon page), 1 `currency_not_jurisdiction` (a London shop serving USD). Q13 CLOSED for the three websites by `scripts/clean_vendor_catalogue_websites.py`, dry by default, `--apply` refused without `--i-have-the-founders-word` (proven: exit 2, nothing written); the dry run read **4 of 4 rows** and proposed **3** statements; the writer is NAMED (two seeds, both `ON CONFLICT (id) DO NOTHING`, so a cleared website is not refilled) and charmer.com is REPORTED, not proposed. `npx jest --runInBand --forceExit src/vendor-intel src/price-index` on this tree: **390 passed, 27 suites**, of which **27 cases in 2 suites are new here** (`shop-reference-posting`, `shop-reference-sweep`) — the run includes the two market researchers' suites, live in the same worktree; gateway `tsc --noEmit -p tsconfig.spec.json` clean; `eslint --quiet` clean on the six touched files; emoji grep empty; every guard exit 0. **No flag armed, no page fetched by the gateway, no row written to any database.** Four founder questions, Q26-Q29. |
| 2026-09-05 | Claude (research + build, Michigan and Illinois) | **The founder's call — *"research deep and validate … do the best option"* — is ANSWERED, and the answer is TWO options because the two states are not alike.** See the section **"Michigan and Illinois: the best honest line"**. **Michigan gets the human-fetch path**: the MLCC publishes the LICENSEE price a house actually pays, with size and pack on every row, as an `.xlsx`; one real edition (2025-08-03, 804,270 bytes, sha256 `ff592f82…`) measured in full shows **12,530 product rows and zero defects** on every test that caught defects in Iowa and Oregon — no duplicate item code at all, against Iowa's 2,308. Built: `parse-michigan.ts`, `michigan-workbook.ts` (no new dependency — `exceljs` was already here), `price-index-upload.service.ts` and `POST /price-index/upload`, owner/manager, **dry run by default**, `commit` additionally gated on `PRICE_INDEX_UPLOAD_ENABLED`, staleness gate before every write, provenance (person + file name + sha256 + `editionDateFrom: "file_name"`) on every row. **Illinois gets the sentence**, because there is nothing to fetch and that is permanent: 235 ILCS 5/6-19 repealed eff. 1998-01-01, 11 Ill. Adm. Code 100 read whole (53 section headings, none about price), Article VI's only price schedule being a bar's own drink list. **Three corrections to this ADR's own Michigan record, measured:** the cadence is **quarterly (91 days)** not monthly, so `maxAgeDays` 62 would have refused a current book from day 63 — corrected to 105; the block is **host-specific** (`ars.apps.lara.state.mi.us` serves us normally, `data.michigan.gov` serves us and then publishes `Disallow: /`); and *"no honest sample exists to parse"* is no longer true. **Michigan DOES post beer and wine prices** — R. 436.1625 and R. 436.1726 make wholesalers *"file with the commission in Lansing"* quarterly — but filing is not publishing, so they are FOIA-only (Q19). Measured against a `git show HEAD:` copy in a same-depth probe, since deleted: HEAD told an Illinois house *"no index line until one is found"* about a statute repealed 28 years ago. `pnpm --filter @wineops/api-gateway exec jest src/price-index` on the tree reported here: **144 passed / 14 suites**, of which **54 in 4 suites are new here** (`parse-michigan`, `price-index-upload`, `silence-notes`, `price-index.mi-il`); gateway `tsc --noEmit -p tsconfig.spec.json` clean; `eslint --quiet` clean on the 13 touched files; emoji grep empty; `check_gateway_boots.sh` PASS and every other guard exit 0. **Curled live, and the result is itself a finding.** `GET /price-index/MI`, `/IL`, `/Michigan` and `/Illinois` all return `"The index register could not be read. This is unknown, not empty."` — **the new sentences are correct in code and unreachable on this gateway**, because `price_index_postings` does not exist on the production project (the `20260904200000` migration is on this branch, unapplied), so `silenceFor` short-circuits on `readFailed` before reaching them. The log names it: *Could not find the table 'public.price_index_postings' in the schema cache*. This is the same condition the 2026-09-04 trail row recorded, not a regression from this change. `GET /price-index/status` DOES prove the registry live — Michigan now reports `quarterly (the price book moves every 91 days)` with the corrected withheld reason — and `POST /price-index/upload` is mounted, guarded and inert (`armed: false`; an empty body returns *"'' is not a source this register accepts a file for"*, and the Michigan key with no file returns *"no file was sent."*, `written: 0` on both). The sentences themselves are proved through the real service in `price-index.mi-il.spec.ts`. Nothing was fetched on a schedule, no flag was armed, nothing was written to any database. Five founder questions, Q17-Q21. |
| 2026-09-04 | Claude (research + build, how a size is read) | **The founder's question — may a size be taken from anywhere on the page, "research do the best one if it was live SOTA" — is ANSWERED AND BUILT** in `vendor-intel/bottle-size.ts` (`fb47d99c`). The answer is the live SOTA answer and it is not "anywhere": Zyte's own published model instruction ranks selected-variant, then most-specific, then labelled field, and the product NAME **last resort**; Diffbot ships `size` marked *"highly experimental and often unreliable"*. So: a five-level precedence (`structured_offer` -> `variant_option` -> `unit_price_label` -> `spec_field` -> `title`), the raw string and locator recorded in `raw.volume` with every candidate, `weight` never read, an identity gate on structured data, and a new `volume_conflict` refusal so a contradiction never counts as an absence. Findings that outlive the build: `htmlToText` drops `<script>` contents, so **no vendor's JSON-LD had ever reached the extraction model**; WooCommerce's structured data emits no size by construction; Shopify's `unit_price_measurement` was null on 4 of 4 shops read, three of them UK; `weight` is a shipping weight (75000 on a 75cl champagne); the only per-quantity price labels on any of the six pages were a duty table's decoys. **Three of the sweep's 23 recorded vendor websites are no longer the vendor's** — Banfi -> an online-gambling domain, Henry Wine Group -> a wine school, Sevilen -> a women's clothing shop with `beden=s` in its links. The sweep flag was not touched, nothing was written to the database, and no page was fetched by the gateway. |
| 2026-09-05 | Claude (rewrite after the scratchpad wipe, plus two audit fixes) | **This section and its founder questions were LOST** — written 2026-09-04, never committed (`fb47d99c` says "held"), and destroyed with the session scratchpad at ~06:46Z. Rewritten here from the committed tree. **Renumbered Q13-Q16**: the draft used Q8-Q11, and Q8-Q12 were taken in the meantime by the TR/UK research, which keeps them in `price-sources.md` §"Founder-only questions raised by this research". Two defects an audit of the reader found, both now fixed and pinned: (a) `deriveFromUnitPrice`'s docstring claimed a **2%** snap window while `snapToNominal`'s default had already been tightened to **1%** (`bottle-size.ts` `tolerance = 0.01`) — docstring corrected, and a new case pins that a **730 ml** derivation is refused while the same arithmetic onto 720 still passes; proved against a `git show HEAD:` copy mutated to `tolerance = 0.02`, where `derive(21.9)` returns `{ml: 720, raw: 730}`. (b) the pack rule — a printed pack corrects the model's default of 1 but never overrules a pack the model read — was tested only for the override half; the second half is now pinned, proved against a `git show HEAD:` copy with the `item.packSize === 1` condition removed, where the same row writes `pack_size=12` and `normalized_unit_price=21`, **half** the true per-750ml price. Also: `fb47d99c`'s message called the field `volume_source`; it is `volume.source` / `raw.volume.source`, and the section now names it as the code does. Re-measured on the committed tree, BEFORE from `git show fb47d99c^:` copies: **4 admitted / 2 refused with 2 of the 4 chosen out of a text offering two sizes; after, 5 admitted / 1 refused / 0 wrong.** `npx jest --runInBand --forceExit --testPathPattern "src/vendor-intel"` -> **219 passed, 11 suites**; gateway `tsc --noEmit -p tsconfig.spec.json` and `eslint --quiet` clean on the module. The gateway came back up mid-task, so the two live reads WERE re-exercised (read-only, owner session): `vendor-catalogue/search` -> US 18 + TR 5, all 23 with a website; `GET /vendor-intel/site-sweep/status` -> `armed: false`, `lastRun: null`, **0 vendors**. Still not re-exercised, and marked as records rather than verifications: the 23-vendor page fetch (logs lost; re-crawling is a fresh crawl) and `PROVENANCE.md`'s fixture-vs-full-page 6/6 and 13 ms figures (the originals were in the wiped scratchpad). |
| 2026-09-05 | Claude (commit-message corrections, re-added after the wipe) | Three rows that `3b4cf88c` claimed to have recorded were in this file's working tree and were lost; re-added here per `p4-scratch/corrections-queue.md`. **`6edfed6c`** — its message carried provenance that belonged to **`115d2260`**, not to itself. **`2b260dff`** — its message claimed 309 tests across 19 suites; measured, it is **160 static cases across 9 suites**. **`ce6fdcdb`** — its message claimed 159 across 9; measured, **180 static cases across 10 suites**. All three static counts are `grep`-of-`it(` counts and are therefore **lower bounds**, labelled as such: a table-driven `it.each` counts once statically and many times at runtime. History is not rewritten; the correction lives in the note that owns the claim. |
| 2026-09-04 | Claude (research) | Created. Sources fetched and measured the same day; the leading candidate attacked and demoted from class B to class D before being recorded. Registry: `.planning/07-reference/price-sources.md`. Proof: `scripts/fetch_price_sightings.py` |
| 2026-09-04 | Claude (build, index register) | Steps 2+3 BUILT on `feat/mudavym-design-p4`: `price_index_postings` migration (applied to a live local PG — RLS on, anon/authenticated NONE, uniqueness present, assertion NOTICE fired, idempotent), the gateway `price-index/` module (California LIVE via the app's anonymous JWT path; Iowa/Oregon class-D shelf lines; Michigan WITHHELD with the 403 evidence and no fabricated parser), a fetch job defaulting OFF behind `PRICE_INDEX_FETCH_ENABLED` with the staleness gate, and `GET /price-index/:state` + `/status`. 40 tests pass, gateway tsc + eslint clean on the module. Fixtures recorded in `.planning/07-reference/price-sources.md` and the module's `__fixtures__/`. |
| 2026-09-04 | Claude (build, sweep, correction) | Founder's second call, applied to `vendor-site-sighting.ts` and its tests on top of `115d2260`: `observed_at` = our fetch clock, the page's claimed date = `effective_date`, `raw.fetchedAt` beside both, `undated` unchanged. The comparison's 30-day window therefore reads our read date and never a claimed effective date. `jest src/vendor-intel` 137 pass. |
| 2026-09-04 | Claude (build, sweep) | Q1 answered by the founder and BUILT: the scheduled vendor-site sweep (OFF by default), tier-4 labelling with the undated flag and the shared outlier test, and the class gate that keeps a tier-4 row out of `items`. 30 new tests in `vendor-intel` (136 in the directory, all green); the gate proven against a copy of HEAD, where the same rows produced a fabricated 50% saving. Dry run against `www.wine.com` and `www.klwines.com`: robots honoured, both 403 at the page. The gateway on :4000 was DOWN for this session, so nothing was curl-verified. |
| 2026-09-04 | Claude (build) | Step 1 BUILT on `feat/mudavym-design-p4`: `own-paper-sighting.ts` + `recordOwnPaperSighting`, both `price_history` call sites mirrored, idempotent on the existing `(source_ref, content_hash)` index, `is_outlier` written by `flagOutliers` at write time (founder's instruction; the divergence from this ADR's own batch-pass wording is recorded in the Status). 14 tests pass; `GET /vendor-intel/below-average` still 200 with `scanned.observations` 0 locally, the register being empty in this environment. Two new founder questions (Q6, Q7). |
| 2026-09-04 | Claude (build) | **Q7 ANSWERED (BOTH) and CLOSED.** The third writer (`recordManualObservation`) is now screened with the same function and floor as the other two, restricted to its own comparison class. The nightly re-judge is BUILT (`vendor-intel/outlier-rejudge.ts` + `.service.ts`), OFF by default behind `PRICE_OUTLIER_REJUDGE_ENABLED`, judging the readers' own trailing-30-day window, with `GET /vendor-intel/outlier-rejudge/status`. Migration `20260905000000_an_outlier_verdict_names_its_reason.sql` adds `outlier_reason` / `outlier_judged_at` / `outlier_basis` (all nullable; `is_outlier` and RLS untouched). 309 tests pass across `src/vendor-intel` + `src/analytics/engine`; the disarmed status route verified live on :4000. One founder-visible consequence recorded under Q7: a market row's verdict is necessarily platform-wide. |
| 2026-09-04 | Claude (market research, TR + UK) | **Q4 researched, not decided.** ~65 fetch attempts recorded in `.planning/07-reference/price-sources.md` §"Türkiye and the United Kingdom, 2026-09-04". Verified: GİB ÖTV (III)(A) PDF, HMRC duty rates, hal.gov.tr HKS (daily, TL/kg, live today), Defra wholesale fruit and veg CSV, ONS `d7bv` JSON, TÜİK/Metro/Bizim Toptan robots.txt, five Turkish producers, five UK trade portals, WSTA, Liv-ex, AHDB terms. Unverified and named as such: resmigazete.gov.tr and mevzuat.gov.tr (TLS/DNS), TCMB EVDS, İBB Swagger, Booker, Brakes, Venus, all three UK grocers' robots.txt. Found the class-A USD-default defect above. Q5 updated (quote requested); Q8–Q12 filed in the registry. No code changed. |
| 2026-09-04 | Claude (build, the index line on /notifications) | **The founder's call of 2026-09-04 — *"Run it, labelled tier 4, never beside a quote"* / *"Show as a labelled index line, own register"* — is BUILT on the page.** `apps/web/src/pages/notifications/next/MarketIndexPanel.tsx` + `useHouseIndex.ts` draw `GET /price-index/me` as their OWN box below the market box, on `--paper-0` against its `--paper-1`, with each line's class, issuer, issue date, posted unit and basis, printed as posted and never normalised to a bottle. The four silences are told apart in the endpoint's own words, and a withheld publisher (Michigan) is named even when the register is silent for another reason. The older tier-4 patch to `MarketPricePanel.tsx` / `useMarketPrice.ts` was re-checked against the current tree and applied; its rule-paragraph wording ("this house's own quotes plus public list prices") was NOT kept, being false once the classes were separated. Measured live on :4000 with a dev-bypass owner session: `me` -> no `state_province` on the demo house; `Michigan`/`Illinois`/`California` -> "The index register could not be read" (`price_index_postings` is not present on that project; the migration is on this branch, unapplied); `Turkey` -> not a recognised jurisdiction. So the withheld sentence is real but **unreachable today** — the read failure short-circuits it. Found and fixed while building: a date-only `issued_at` rendered through `new Date` printed the ISSUER'S DATE ONE DAY EARLY west of Greenwich. 96 vitest in `pages/notifications/next` (24 new), web tsc and eslint `--quiet` clean on the directory, `check_no_seeded_defaults.py` PASS, emoji grep empty. Captures: `shots-index-line/notifications{,-charcoal}.png`. |
| 2026-09-05 | Claude (market research + build, TR + UK) | **Q4 ANSWERED and the codes are BUILT.** Founder's call the same day: *"their own source class, researched per market"*. Every load-bearing claim re-fetched 2026-09-05 (log: `$SP/p4ab-fetch-log.md`, ~30 fetches with status and first bytes). **Türkiye: none found** — HKS is live and dated (bulletin 5.09.2026) but has no machine endpoint, its two REST alternatives returned 403 and an empty reply, GİB is a tax whose unit is unstated, TÜİK renders "JavaScript Required", and `mevzuat.gov.tr`/`resmigazete.gov.tr` refused this environment a second day. **United Kingdom: one found** — Defra's wholesale produce CSV (HTTP 200, 861,585 B, sha256 `ab56ded3…c258c3d`, 17,594 rows, OGL v3.0, issuer + date + unit + GBP, extent "England and Wales" = `GB-EAW`), built as `parse-defra.ts` with a 59-row fixture of real bytes. **The trap found and avoided:** ONS's four RPI drink average-price series still return HTTP 200 with `releaseDate` 2026-08-18 and `nextRelease` 16 September 2026 while every last observation is **2025 JAN** — recorded `silent: discontinued`; only the observation-date staleness gate catches it. `normalizeJurisdiction` learns ISO 3166-1 (`TR`/`GB`/`US`), all 81 ISO 3166-2:TR provinces and ISO 3166-2:GB incl. `GB-EAW`/`GB-UKM`; `forHouse` falls back to `restaurants.country`; a new `silent` field sits beside `withheld` (read-but-priceless vs unreadable) and Michigan's entry was not touched. **Measured: `restaurants.currency` is `USD` on all 14 houses**, which settles Q10 — the repair is a data correction, not a writer fix, and was not made (a write). Verification: `npx jest --testPathPattern "src/price-index"` from `apps/api-gateway` — my four suites 59/59 pass; module-wide 116/117 with the one failure in another builder's in-flight `parse-michigan.spec.ts`. Gateway tsc `-p tsconfig.spec.json`: 0 errors in `src/price-index` (1 error in another builder's `one-tap-actions.service.spec.ts`). eslint `--quiet` clean on `src/price-index/*.ts`; seven guards exit 0; emoji grep empty. **Live curls NOT exercised: the gateway would not boot** — `BOOT_FAIL: Nest can't resolve dependencies of the OneTapActionsService … ProcurementService`, another builder's module, on every retry between 07:23 and 07:35Z. Proved instead with a temporary probe (created, run, deleted) that instantiated the REAL `PriceIndexService` against the project the gateway points at, read-only: `Muğla`->`TR-48`, `Türkiye`->`TR`, `England`->`GB-ENG`, `USA`->`US`, with the correct source lists, and `/me` for the three real houses resolving `requested` `Muğla` / `Türkiye` / `England` — the Antalya house proving the `country` fallback on real data. **Every one of them then returned "The index register could not be read"**: `restaurants` read fine in the same run, `price_index_postings` did not (the migration is on this branch, unapplied on that project). So the market sentences are correct and, in that environment today, unreachable — the read-failure branch stands in front of them, exactly as recorded for Michigan's withheld sentence on 2026-09-04. Four new founder questions, Q22-Q25. |
| 2026-09-05 | Claude (build, the produce line) | **Q24 ANSWERED by the founder and CLOSED, built the same day.** *"Show it, labelled as produce, in its own box"*. `price-index.registry.ts` gains a `display` block on the Defra entry (category / short issuer / extent, the publication's own words) and says in the entry that arming is `PRICE_INDEX_FETCH_ENABLED` on the deployment and nothing else; the endpoint carries `display` on every source row; `MarketIndexPanel.tsx` splits lines by SOURCE and draws a labelled one in its own titled section below the drinks list — *Wholesale produce - Defra - England and Wales - read on 5 Sep 2026* — with *"It is not a drinks price and is never compared with one."* under it. The GB market sentence stopped saying "no market price" (true of drink, false once a source is shown) and now names the produce list; a jurisdiction whose only fetchable source is a labelled one gets `unarmedDisplaySilenceFor`, which names the env var rather than claiming a "posted list" the UK does not have. **Pre-fix proof:** a probe copy of HEAD's panel (renamed only, run, deleted) rendered the same two rows into ONE `<ul>` under the single heading "Control-state shelf price - GB-ENG" with the word "produce" absent from the document — a GBP 0.62 cabbage beneath a $34.99 rye. Two faults found in the first capture and fixed: an em-dash container size on a per-kilogram row (a size is a fact about a bottle), and *"to average wholesale market price"* (`to X` names a trade level). **Counts, my runs:** `npx --prefix apps/web vitest run src/pages/notifications/next --root apps/web` -> 6 files, **104 passed**; `npx jest --testPathPattern "src/price-index"` from `apps/api-gateway` -> 15 suites, **151 passed**. Web tsc: **0 errors in `notifications/next`** (6 elsewhere, in `orders/next/AgreementFees.test.tsx` and `providers/next/TermsSection.tsx`, another builder's). Gateway eslint `--quiet` clean on `src/price-index/*.ts`; **web eslint could not run in this environment** (`eslint-plugin-jsx-a11y` missing). `check_no_seeded_defaults` and `check_read_columns_exist` exit 0; `check_read_errors_not_swallowed` exits 1 on a baseline row for `procurement.service.ts preCancelRow` — another builder's fix, in the good direction, not mine to re-baseline. Emoji grep clean. **Captures: `p4-scratch/shots-defra-line/` — `produce-box-{paper,charcoal}.png`, `index-register-{paper,charcoal}.png`, `notifications-{paper,charcoal}.png`, every one banner-labelled STUB**: `price_index_postings` is absent from the project this deployment reaches and the fetch is unarmed, so the rows are real values from the 31/08/2026 edition served by `page.route`, and no request left the browser. |
| 2026-09-05 | Claude (build, a house's currency) | **Q25 ANSWERED by the founder and BUILT.** Verbatim: *"correct three rows now, ask each house in onboarding, but set a default based on location, edge case: there maybe several diff currencies, so act accordingly to that"*. **Measured on production, read-only:** 14 houses, `currency = 'USD'` on **all 14**, three of them not in a dollar country (Chez Community / The Old House Pub in Türkiye, ADMIN 1 in London); `price_history` 0 rows and **no currency column**; `procurement_documents` 5 rows of which **2 are TRY, on a house whose own row says USD** — the founder's edge case, already live. **Six** columns named `currency` exist in `public` and **every one defaults to `'USD'`**. **The writer that set USD is the column default** (`20260805000000:3576`); `registerRestaurant`'s insert named no currency key, so no code was wrong and the repair is data plus shape. **Built:** `20260905120000_a_house_names_its_money.sql` (drops the default, ISO-4217 CHECK on both, adds nullable `price_history.currency`, four comments, **writes no data**, NOTICEs how many houses still carry USD); `scripts/correct_restaurant_currency.py` (dry by default, `--apply` refused without `--i-have-the-founders-word`, `--self-test`, prints whole tuples + FK sweep + exact statements); `components/onboarding/CurrencyStep.tsx` + `lib/currency.ts` (a STATED default from the address's country, "Not yet" records nothing, an unplaceable country gets NO default and says so); `procurement/price-currency.ts` and a required `currencyClaim` on `recordPriceHistory`; `own-paper-sighting.ts`'s `?? "USD"` becomes a refusal. **83 foreign keys reference `restaurants`, every one on `id`** — the UPDATE touches no key. **Verification:** jest `own-paper-sighting` 22/22, `price-currency` 14/14, `register-currency` 4/4, `vendor-terms` 36/36; vitest `currency` 12/12, `Register.currencyStep` 12/12, `TermsSection`+`SettingsNext` 59/59; gateway `tsc -p tsconfig.json` 0 errors and `-p tsconfig.spec.json` 0 in my files; web `tsc` 0 in my files; gateway eslint `--quiet` clean; nine guards run (`check_queried_tables_exist` and `check_read_errors_not_swallowed` fail on **other builders'** work — 0 NEW relations, and a `preCancelRow` baseline row another hand deleted); `check_gateway_boots.sh` PASS; `check_decision_claims.sh` 226/226; migration prefixes unique; emoji grep empty. **Pre-fix proof:** a `git show HEAD:` copy of `own-paper-sighting.ts` run beside the current one — PRE-FIX `currency: "USD"` on a Turkish invoice stating none, POST-FIX the refusal sentence; probe deleted. **NOT done, and said rather than left to be found:** the three rows are still USD (the correction is a write and waits on the founder's word); the migration was NOT executed anywhere (no Docker, no psql on this machine); the receiving screen does not yet send `invoiceCurrency`, so a verified receipt records NOTHING for currency today and writes no class-A sighting at all. Four new founder questions, Q30-Q33. |
| 2026-09-05 | Claude (build, the three currency decisions) | **Q30, Q31 and Q33 ANSWERED by the founder the same afternoon and BUILT; the three wrong rows were CORRECTED in production on his word** (read back: ADMIN 1 `GBP`, Chez Community `TRY`, The Old House Pub `TRY`, `updated_at` 2026-09-05T12:40:5x — the trigger fired as documented; 11 rows still `USD`). **Q30** *"Clear all eleven to unrecorded; the onboarding step asks"*: `--clear-inherited` added to `scripts/correct_restaurant_currency.py`, dry by default, `--apply` refused without the founder's-word flag. Dry run reads **11 clear / 0 correct-first / 3 stated / 0 already-unrecorded**. NULL needed **no migration** — `restaurants.currency` is `is_nullable = YES` in the live catalogue and always has been. The self-test now asserts the two modes are **DISJOINT** on 13 rows, which caught a real hazard: a row that is wrong AND inherited was claimed by both, so the correction now wins and clearing defers (`correct-first`). **Q31** *"A currency column on the agreement line"*: `20260905200000_the_agreement_names_its_money.sql` adds `procurement_order_items.currency` (nullable, no default, ISO 4217 CHECK); `agreement-currency.ts` resolves the sheet's stated default — **measured: `restaurant_vendor_terms` has seven columns and no currency**, so "the vendor's terms" reads the vendor's own PAPER (`procurement_documents.currency`, by the document's own date) then the house then nothing; `GET /procurement/agreement-currency` serves it so the sheet and the writer use ONE tested chain; `AgreementSheet` shows it with the gateway's own evidence sentence. **This restores what Q25 cost:** a confirmed order with a stated currency now writes a class-A sighting again, where the refusal had blocked every one. **Q33** *"One country table keyed by ISO code"*: `lib/countries.ts` rebuilt as 194 rows keyed by ISO 3166-1 alpha-2 with display name, currency and aliases; `PlacesAutocomplete.COUNTRY_ISO` (113 pairs) and `currency.ts`'s `COUNTRY_CURRENCY` (122 pairs) DELETED; `countries.migration.test.ts` freezes all three retired tables verbatim and asserts every pair still resolves. **Measured: no country-name table exists outside `apps/web`**, and the gateway depends on no workspace package, so one table in the app that has the surfaces is the whole answer. **Verification:** both migrations EXECUTED against a real Postgres (PGlite, `$SP/pglite-probe/p4am-probe.mjs`) — **17/17**, in-file assertions passed, every CHECK bites (`'usd'`, `'US$'`, `'TL'` all 23514), NULL accepted on all three columns, and a house inserted naming no currency comes out **NULL, not USD**. jest 140/140 across 8 suites; vitest 190/190 across 12 files incl. 11 new retirement-proof cases and 7 new sheet cases; gateway `tsc` and web `tsc` clean in my files; gateway eslint `--quiet` clean; seven guards exit 0. **New guard:** `check_money_states_its_currency.py` — a baselined census of every rendered money figure that pins a currency, **53 files / 96 sites**, which only ever shrinks; it exits 2 if it matches nothing, and it caught the new country table on its first run (allowlisted with the reason). An earlier draft of it reported 1,465 sites because its patterns matched every template literal; that number was noise and the patterns were narrowed. **NOT done:** the clear-inherited apply (the founder runs it); Q32, so a verified receipt still records no currency; the 96 baselined `$` sites, which have no house currency in scope; and nothing lets a house change its currency after sign-up (Q35), which the clearing pass makes urgent. Two new questions, Q34-Q35. |
| 2026-09-05 | Claude (research + build, approval tiers) | **Q18 is ANSWERED, in [0128](0128-an-approval-fits-the-decision.md), and the answer is a tier rather than a rule.** The founder: *"Yes, it needs an approval however we can't wait 2 people to approve a small decision, or a big one."* Both halves are constraints and the second one is a fact about this estate, measured read-only against production the same day, twice: of 15 houses **TEN have one owner-or-manager or none**, and of the eight jurisdictions the estate resolves to **FIVE contain exactly ONE person** — so "always two" would have been "never" for most of it. Because `price_index_postings` has no `restaurant_id` (`20260904200000`'s own header), the pool is the JURISDICTION and not the house; US-MI, the only jurisdiction with an uploadable source today, has three houses and **three** distinct owner-or-manager people. **This ADR's own framing of the defence is confirmed and sharpened, not overturned:** provenance stands, because a forged single price is 1 row in 12,530 and no band — and no second human being reading a table — will ever see it. What a second person CAN do is fetch the book from the issuer themselves and compare the sha256, so `POST /price-index/uploads/:id/confirm` accepts the bytes and records `byte_match` only when they agree, `attested` when nothing was produced, and `same_person` with a stated reason where the jurisdiction has nobody else (GAO-25-107721 §10.23). The upload path built here on 2026-09-04/05 is unchanged in every respect except that its rows now land HELD unless the book is a routine later edition: `price_index_postings.admitted_at`, one exported `MARKET_VISIBILITY` predicate on every read, and a panel label so a held book never reads as "nothing is posted here" — the same fault this ADR corrected for Illinois, wearing the other hat. Q17's four provenance columns are untouched and are what the review row joins on. |
| 2026-09-05 | Claude (build, Q29 recorded and applied; Q26's reading made to agree) | **Q29 ANSWERED by the founder and BUILT; Q26's aftermath guarded.** Q29, the founder: *"Not a source until it quotes GBP unprompted."* `ShopUnarmedReason` gains `quotes_another_market_currency` — Hedonism had been filed under `terms_unstated` behind a detail opening *"Not a terms problem but a CURRENCY one"*, which made the one shop blocked on presentment currency uncountable against the two blocked on unread terms. Its row now carries the founder's words, the measurement (`priceCurrency: USD` + `og:price:currency: USD` on `hedonism-ruinart-2026-09-04.fixture.html`) and **the rejected path recorded on the row itself** — a `?currency=GBP` hint, refused because a price whose currency depends on what we sent is a price we half-made. Wine Chateau keeps `serves_no_house` with the founder's confirmation. **Every unarmed block gains a required `armsWhen`** naming the OBSERVATION that lifts it, never a date: Hedonism's demands GBP served to an ANONYMOUS fetcher and states that a GBP figure obtained by asking for GBP does not count; Wine Chateau's is a fact about the estate (a house in NJ), so the row says nothing the shop does can lift it. All six blocks were given one, so the field is a rule rather than one row's decoration. **The state is printed where the state is shown:** `ShopSweepStatusRow` gains `unarmedReason` and `armsWhen` beside `detail`, and the run notes append "It arms when …"; `armedShopKeys` already dropped a blocked key whatever `PRICE_REFERENCE_SHOPS_ARMED` said, and a test now asserts that so the block is the mechanism, not a note about one. **Q26:** the parent cleared all seventeen stamps in production at 2026-09-05T20:35:56Z and `20260906040000` refuses a sourceless one, which leaves the column NULL on every row — and the NULL is the dangerous half. **Measured on this tree: NOTHING reads it.** It is declared on the distributor row type, returned by `search_distributors` and `vendor_catalogue_match`, and carried to the client unread; the page's "verified only" toggle filters `listing_tier === 'curated'`, a different fact. So there was no reading to correct, only one to prevent: the rule is recorded at the column's declaration, and **new guard `scripts/check_verified_at_is_not_a_boolean.py`** refuses any truthiness or null test on it in a vendor-catalogue/distributor file — **13 in-scope files name the column, 0 test it**; `--self-test` passes 7 probes; **proven to BITE** against a temporary probe that wrote `if (!row.verified_at) return true` (exit 1, the line named), probe then deleted; exits **2** rather than passing if its scope stops matching. **Verification:** `npx jest --runInBand --forceExit src/vendor-intel` from `apps/api-gateway` — **370 passed, 19 suites**, of which **7 cases are new here** (`src/vendor-intel/shop-reference`: 37 passed, 2 suites). Gateway `tsc --noEmit` and `-p tsconfig.spec.json` both clean. `check_read_columns_exist.py` and `check_money_states_its_currency.py` exit 0; `check_no_conflict_markers.py` and `check_citation_pairing.py` PASS; emoji grep empty on the touched files. **Nothing was armed, no shop fetched, no row written to any database, and the block on Hedonism was not lifted — only named.** NOTE ON AUTHORSHIP: this session did not build the merchant-shop sweep; it recorded two founder answers onto another builder's work and kept to those hunks. |

---

## Addendum — the register's tenancy boundary, and a third visibility state (2026-09-05, batch 56)

### The founder's words, and what they required

Asked whether the fifteen houses of ADR 0128's production census are real
independently owned restaurants or test tenants — specifically the Illinois trio
(YARDOM, YAREN, Yaren's Fine Dine) and ADMIN 1 / Sim Bistro — the founder
answered **"All real."** He accepted the consequence with the option, recorded in
ADR 0126:

> the contributor floors researched in `p4be-market.md` apply as written, and the
> register's **tenancy boundary (nine hand-written filters and no RLS policy)
> must be fixed before any cross-house read** — dispatched as its own build.

This is that build. It is **the boundary, not a cross-house read**: nothing here
pools, aggregates, bands, or shows one house anything belonging to another. What
it does is make it impossible to write a read that does so by accident.

### The measurement, first — and a correction to the number in the instruction

`grep -rn "restaurant_id.is.null" apps/api-gateway/src --include="*.ts"` returns
twenty lines on this tree. Six are live tenancy filters on the two register
tables. **Three of the "nine" filter other tables entirely** and were counted by
mistake in `p4be-market.md` §5 and carried into ADR 0126's sentence:

| Cited as a register filter | What it actually filters |
|---|---|
| `identity.service.ts:701` | `beverage_identity_candidates` |
| `identity.service.ts:924` | `beverage_identity_decisions` |
| `invoice-confirmed.producer.ts:261` | `providers` |

The shape of the finding was right and the count was not. The corrected census of
the boundary, measured with
`python3 scripts/check_price_register_reads_are_scoped.py` on the pre-fix tree:

- **6 hand-written `.or("restaurant_id.is.null,restaurant_id.eq.<id>")` filters** —
  `vendor-comparison.service.ts:169,407,476`, `vendor-page-extractor.service.ts:592`,
  `procurement.service.ts:1910`, `market-price.producer.ts:315`.
- **2 hand-written `MARKET_VISIBILITY` applications** on `price_index_postings`
  (`price-index.service.ts:329,587`) — one exported constant, the better shape,
  but still applied by hand at each site.
- **6 reads with NO visibility clause at all**, which is the more serious half
  and which the register-gap finding did not name:
  `outlier-rejudge.service.ts:107` (every house's rows),
  `identity.service.ts:190` (an estate-wide count),
  `price-code-mappings.service.ts:269` (a count),
  `procurement.service.ts:1780` (a dedup existence check),
  `beverages.service.ts:907` (house-only, strictly narrower — not a leak),
  and `price-index.service.ts:635`, which counted **held books as index-line rows
  in `/price-index/status`** — the exact number `countFor` five lines above it
  refuses to report, in the same service, about the same source.
- **Zero `CREATE POLICY` naming either table** other than `price_index_postings`'
  service-role one.

### What was built

**1. One enforcement point.**
`apps/api-gateway/src/price-register/visibility.ts` exports
`scopePriceRegisterRead(query, table, scope)`. Ten reads now pass through it and
the six hand-written filters are gone. Its scopes are named rather than implied —
`houseAndOpenMarket`, `houseOwnRowsOnly`, `openMarketOnly`, `everyHouse` and
`includingHeldBooks`, the last two requiring a non-empty `because` — so a read
that genuinely crosses houses is a sentence somebody had to write, and a reviewer
finds every one of them by grepping a single word. It also refuses an id carrying
a character that would change the meaning of the filter string it is interpolated
into (`restaurant_id.eq.${id}` is a string, not a bound parameter), and refuses a
scope on a table where it means nothing rather than reading everything.

**2. The third visibility state.**
`20260906100000_the_register_states_who_may_see_a_row.sql` adds
`vendor_price_observations.visibility` — nullable, no default — with
`vpo_visibility_check` admitting exactly `house`, `open_market` and
`contributed_aggregate_only`, each tied to `restaurant_id` so the column can
never disagree with the thing it describes. **No row is in the third state and no
read returns one**: the migration asserts the row count is zero, and the
enforcement point excludes the state on *every* scope including `everyHouse`,
applied first, before any scope can widen anything. `visibility IS NULL` is not a
fourth state — it means "whatever `restaurant_id` says", which is the two-state
rule the register has always had.

**3. RLS, and an honest account of what it protects.**
The same migration adds `vendor_price_observations_authenticated_read` (the house
+ open-market + not-contributed rule, joined through `user_restaurant_access`
exactly as `cocktails_authenticated_read` does) and
`price_index_postings_authenticated_read` (ADR 0128's admission rule), plus
service-role policies and `REVOKE ALL ... FROM anon, authenticated` on both.

**These policies protect nothing today, and the file says so in its header.** The
gateway holds `SUPABASE_SERVICE_ROLE_KEY` (`database.service.ts:15`) and the
service role bypasses RLS, so for every read this product makes the enforcement
point *is* the entire boundary. Nor do they tighten anything for a JWT-bearing
caller, because both tables are already shut to one: `vendor_price_observations`
has had RLS on with no permissive policy since `20260805154027:145` (a table with
RLS on and no policy returns zero rows), and `price_index_postings` has RLS on
plus a REVOKE. The policies are a **statement of the rule** written while nothing
depends on them, so the day someone grants a JWT role access is not also the day
the rule has to be invented. No GRANT is added here: adding one would open a
table that is currently shut, which is the opposite of this file's job.

**4. A guard.**
`scripts/check_price_register_reads_are_scoped.py`, wired into `ci.yml` beside
the other guards with its `--self-test`. A read of either table must sit inside
the first argument of a `scopePriceRegisterRead` call whose second argument names
the same table; arguments are found by balancing brackets, not by a proximity
window, because the first version of the guard used a window and it credited an
unscoped read for a compliant neighbour's scoping and credited a scope call that
named the wrong table. Both are now regression cases in the self-test. Exit 2 —
CANNOT CHECK, never a pass — when a read root is gone, when the enforcement point
is missing or renamed, when the migration's CHECK and the TypeScript constant
disagree about the third state's name, or when an allowlist entry no longer
describes its file.

### What was deliberately not done, and why

**Four reads were left unconverted and are allowlisted by name.** They live in
`procurement/**`, `notifications/**` and `distributor-feed/**`, which other
builders hold open in this same worktree; editing across that line risks a
conflict in files nobody asked me to touch. Two of the four already carry, by
hand, the identical predicate `houseAndOpenMarket` applies — duplication, not
leaks. The other two project no row at all, only a count or an id. **None is an
open leak today**, and the allowlist pins the exact text that makes each of those
sentences true: if it changes, the guard exits 2 rather than continuing to pass.
They should be converted on merge.

**The nightly outlier re-judge keeps its cross-house read**, now named
`everyHouse` with its reason on the call. It has no caller and no house; it exists
to write `is_outlier` back onto every house's own rows, and `planRejudge` buckets
on `row.restaurant_id ?? "market"` (`outlier-rejudge.ts:221`), so no house is ever
judged against another's prices. Two things are worth recording rather than
leaving to be discovered: the job is **off in every environment**
(`PRICE_OUTLIER_REJUDGE_ENABLED` is unset), and it judges a house's row against
that house's rows ALONE while the write-time test pools the house's own rows with
the open market — a real inconsistency between the two verdicts on the same row,
in the pure module, out of scope here and noted in `vendor-prices.md` §9.

### Rejected alternatives

**Leave the filters as they are.** The strongest case for it: all six were
correct on the day they were measured, the tables hold zero rows, and a
refactor of six working queries buys nothing a careful reviewer would not
catch. It was rejected for one reason that outlives all of that — **the failure
mode is silent and asymmetric.** A forgotten `.or()` does not throw, does not
log, and does not return fewer rows; it returns *more*, and the extra rows are
another house's buying terms. There is no error to notice, no empty page to
investigate, and no RLS policy behind the query to catch it. Six correct copies
of a rule are six chances to write the seventh wrong, and the founder's "All
real" is precisely what converts that from a hypothetical into fifteen real
businesses' negotiating positions. A rule that can be forgotten will be.

**A NOT NULL `visibility` with a DEFAULT.** Rejected: a default would have to
choose between `house` and `open_market` without being able to see
`restaurant_id`, so it would state a falsehood on half the rows, and
`check_no_seeded_defaults.py` exists to argue with exactly that.

**Hide `.from()` inside the enforcement point** (`priceRegisterQuery(client,
table, scope)`), which would have made the guard a one-line grep. Rejected on
measurement: `check_read_columns_exist.py` pairs a literal `.from("t")` with the
`.select(` that follows it (`scripts/check_read_columns_exist.py:328`), so moving
the table name out of `.from()` would have made every register read invisible to
the guard that verifies its columns exist. Trading one guard for another is not a
gain.

**Add a GRANT so the new RLS policies do something.** Rejected: it would open two
tables that are currently shut to every JWT role, in a change whose purpose is to
close things.

### Verification, measured on `feat/mudavym-design-p4`

- `npx jest src/vendor-intel src/price-index src/price-register src/beverages`
  from `apps/api-gateway`: **668 passed, 43 suites**, of which **16 in the new
  `price-register/visibility.spec.ts`** and **5 added** to
  `vendor-comparison.service.spec.ts`, `price-below-average.spec.ts` and
  `outlier-rejudge.spec.ts`.
- The migration **PGlite-proven**: `p4-scratch/pglite-probe/p4bk-register-visibility.mjs`
  applies the ten real creating migrations onto stubbed leaf parents and reports
  **26 passed / 0 failed** — the CHECK refuses all four disagreements with
  `restaurant_id`, a NULL visibility still writes on a row with and without a
  house, the exclusion predicate is measured (5 rows written, 4 visible with the
  `IS NULL` arm, **2 without it** — which is why that arm is not redundant), four
  policies exist, and `authenticated` is refused at the GRANT (42501) before RLS
  is ever consulted.
- The guard **proven to bite against pre-fix code**, per the branch's rule:
  `git show HEAD:...vendor-comparison.service.ts` and
  `git show HEAD:...price-index.service.ts` into same-depth probe files —
  **exit 1, six findings**, the three vendor-comparison reads and the three
  price-index reads named by line; probes deleted.
- `--self-test` passes; `check_read_columns_exist.py`,
  `check_new_tables_are_locked_down.py`, `check_fk_targets_exist.py`,
  `check_no_seeded_defaults.py`, `check_migration_versions_unique.py` all exit 0.
- Gateway `tsc --noEmit` clean; `-p tsconfig.spec.json` clean **on every file
  this build touched** (its only errors are in `commodity/**` and
  `communications/**`, another builder's in-flight edits).
- `check_gateway_boots.sh` **PASS**, run against an isolated copy under
  `p4-scratch/bootprobe-p4bk/` that differs from the worktree only in restoring
  `commodity.service.spec.ts` from HEAD — on the worktree itself the build fails
  on a stray comma at `commodity.service.spec.ts:114`, another builder's file,
  which no change of mine can reach.
- `eslint --quiet` clean on all eleven touched gateway files. No emoji.
- **Nothing was written to any database.** The migration has not been applied
  anywhere; the local gateway points at production and was not used.

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-05 | Claude (build, the register's tenancy boundary — founder batch 56) | **Addendum recorded.** One enforcement point (`price-register/visibility.ts`, `scopePriceRegisterRead`) replaces the six hand-written tenancy filters and the two hand-applied `MARKET_VISIBILITY` sites; ten reads now pass through it, including six that previously carried NO visibility clause at all. A third visibility state (`contributed_aggregate_only`) is defined with a CHECK, with **no row in it and no read that returns it**, both asserted. RLS policies on both tables state the rule in SQL and the migration's own header says plainly that they protect nothing while the gateway holds the service role. New guard `check_price_register_reads_are_scoped.py` + `--self-test`, wired into `ci.yml`, **proven to bite** on HEAD copies of two converted files (exit 1, six findings, probes deleted). **Corrects the "nine filters" figure** this ADR's instruction inherited from `p4be-market.md` §5: three of the nine filter `beverage_identity_candidates`, `beverage_identity_decisions` and `providers`, not the register. **Also fixed:** `price-index.service.ts:635` counted held books as visible rows in `/price-index/status`, contradicting `countFor` in the same file. **Four reads left unconverted and allowlisted by name** in `procurement/**`, `notifications/**`, `distributor-feed/**` (other builders' files this wave); none is an open leak and each is pinned so the entry cannot rot into a silent pass. 668 tests / 43 suites pass; migration PGlite-proven 26/0; boot check PASS on an isolated probe. Nothing written to any database. |
