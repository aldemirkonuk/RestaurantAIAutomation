---
type: reference
title: Price source registry
status: live
updated: 2026-09-05
links: ["[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]", "[[0111-the-calendar-is-the-houses-day-book]]", "[[0114-connections-are-the-houses-profile-is-the-persons]]"]
---

# Price source registry

Every source this house could fetch a price from, what class it is under
[ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md),
and **what happened when it was actually fetched on 2026-09-04**. A source that could not
be read is recorded as *unverified*, never as *unavailable* — a 403 to our fetcher is a
fact about our fetcher.

**Retire-to-write.** This file supersedes the price-source claim implicit in the
`Wine data | vivino.com, wine-searcher.com, www.opentable.com` row of
[`.planning/foundation/EXTERNAL_CONNECTIONS.md:153`](../foundation/EXTERNAL_CONNECTIONS.md).
That document keeps its job — the census of hosts the code calls — and stops being the
place anyone reads to learn where a price comes from. There was no other price-source list
in the corpus: greps for `Wine-Searcher`, `LibDib`, `SevenFifty`, `My Market News` and
`price posting` across `.planning/**` returned that row, ADR 0111's index line, and prose
in three plans that names no source. **Owed and outside this session's paths:** a row in
[`07-reference/INDEX.md`](INDEX.md) pointing here.

## How to read the columns

- **Class** — A own paper · B posted wholesale list · C licensed distributor feed ·
  D retail reference · E public index (ADR 0117).
- **Verified** — `yes` means bytes were fetched and parsed on 2026-09-04 and the row's
  numbers come from them. `partial` means something was measured (a status code, a terms
  page) but not the data. `no` means the fetch failed; the reason is stated.
- **Issuer + date on the row?** — ADR 0117's admission test. A source that does not stamp
  its own publication date cannot produce a sighting, however good the prices are.

---

## Class A — the house's own paper

| Source | Where | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|
| **Verified invoice line** | `price_history`, written by `procurement.service.ts:900` from receipt verification (`:2902`) | rows | per delivery | ours | none | yes — `effective_date`, `source='receipt_verified'`, `order_id` | yes (DB) | **0 rows in production.** The writer exists and is guarded (`check_order_capture_contract.py`); nothing has run through it. It writes to `price_history`, **not** to `vendor_price_observations` — the gap ADR 0117 §1 names |
| **Confirmed order price** | same table, `source='order_confirmed'` (`procurement.service.ts:4393`) | rows | per order | ours | none | yes | yes (DB) | **0 rows.** `procurement_orders` = 2, `procurement_order_items` = 1 |
| **Invoice document lines** | `procurement_document_lines.unit_price` | rows | per document | ours | none | yes, via the parent document | yes (DB) | **0 rows**, and `procurement_documents` = 0 |
| **Catalogue reference price** | `master_wine_library.price_reference` | column | none | ours | none | **NO** — no date column, no issuer column | yes (DB) | **3,674 of 4,226 rows carry one**, 3,474 of them from `source='menu_corpus'` — i.e. **restaurant menu list prices**. `retail_price_avg` exists and is NULL on all 4,226. **Inadmissible under ADR 0117** and already constrained by `PRODUCER_REPUTATION_PLAN.md:31` |
| **Vendor website scrape** | `vendor-page-extractor.service.ts` -> tier 4 `website_scrape`, judged by `vendor-site-sighting.ts` | HTML -> model extraction | **daily cron `20 4 * * *`, OFF by default** (`VENDOR_SITE_SWEEP_ENABLED`); `sweepCatalogue` still available by hand | robots.txt checked, fails closed on a disallow; **`Crawl-delay` now parsed** (`parseCrawlDelay`) and honoured as the floor | **10s per host** (`DEFAULT_HOST_INTERVAL_SECONDS`), raised to the host's own Crawl-delay when larger, never below 2s; identifying UA | yes - `source_url`, `content_hash`, `http_status`, **`observed_at` = when WE fetched it** (the comparison window reads this column, so it is never a claim printed on the vendor's page), and **`effective_date` = the page's own claimed date** when it makes one, else NULL with `raw.undated = true`; `raw.fetchedAt` and `raw.pageStatedDate` carry both dates on every row | yes (code + a live dry run) | **BUILT and RUN once, in dry run, 2026-09-04** (founder's Q1 answer: *"Run it, labelled tier 4, never beside a quote"*). `www.wine.com/robots.txt` fetched with the identifying UA: **6,038 bytes, no `Crawl-delay` for any agent**, `/search` **disallowed** (no permitted way to enumerate a catalogue), `/` and `/product/*` allowed. The allowed homepage then returned **HTTP 403** with a DataDome captcha body (768 bytes). `www.klwines.com` returned **403 to the robots.txt request itself**, behind a Cloudflare challenge. **Two of two real merchant sites refused this environment at the page** - recorded as unverified, never as unavailable. Production still holds 23 active `vendor_catalogue` vendors with a website; the sweep now reads `providers` per restaurant instead, so a sighting is never written tenant-less. Refusals are counted by reason and reported at `GET /vendor-intel/site-sweep/status` **UPDATED 2026-09-04 (how a size is read), re-recorded 2026-09-05 after the scratchpad wipe destroyed this edit.** The row's unit is now read from the MARKUP by `vendor-intel/bottle-size.ts` (`fb47d99c`), in the precedence `structured_offer` -> `variant_option` -> `unit_price_label` -> `spec_field` -> `title`, with the raw string, the locator and every candidate written into `raw.volume` (`raw.volume.source`, NOT a `volume_source` column - the commit message was wrong); a contradiction is a new refusal `volume_conflict`, counted apart from `no_bottle_volume`. The reason it had to move off the model's text: `htmlToText` drops the CONTENTS of `<script>`, so **no vendor's JSON-LD had ever reached the extraction model** and every `Bottle Volume` a merchant publishes was being discarded before it was read. **All 23 vendors fetched 2026-09-04** (robots first, our UA, 10s/host; only Palm Bay published a `Crawl-delay`, of 2s): 20 answered 200; Empire Merchants 400, `www.terlatowines.com` a certificate not valid for that hostname, `www.kayrasaraplari.com` NXDOMAIN. **Zero of the 20 emit a schema.org `Product`**, microdata product, `og:type=product`, `UnitPriceSpecification`, `referenceQuantity`, `additionalProperty`, `hasMeasurement`, `gs1:` or `unit_pricing_measure`; exactly one shows a price at all. Platforms: WordPress 11 (WooCommerce 4), Drupal 1, HubSpot 1, 7 unrecognised. **Three recorded websites are no longer the vendor's** - `www.banfivintners.com` -> `dtoto5000.com` (online gambling), `www.henrywine.com` -> `vinology.com` (a wine school), `www.sevilen.com` (filed as the winery Sevilen Sarapcilik) -> a women's clothing shop whose links carry `beden=s`; `www.charmer.com` returns 114 bytes and no title. Six real merchant product pages were fetched instead and recorded as fixtures (`apps/api-gateway/src/vendor-intel/__fixtures__/`, sha256 + full provenance). Measured on them and re-run 2026-09-05 against `git show fb47d99c^:` copies, the pre-reader tree admits 4/6 and refuses 2/6 with 2 of the 4 chosen out of a text offering two sizes; the reader admits 5/6, refuses 1, none wrong. **Re-measured on the live gateway 2026-09-05, read-only**: `vendor-catalogue/search` gives US 18 + TR 5, all 23 with a website; `GET /vendor-intel/site-sweep/status` gives `armed: false`, `lastRun: null` and **0 vendors** — the demo house records no provider website, so the sweep reaches nothing. The 23-vendor page FETCH was not re-run (logs lost in the wipe; re-crawling 23 third-party sites is a fresh crawl, not a re-check). The sweep flag was never set and the gateway fetched nothing. Full reasoning: ADR 0117 §"How a size is read"; its founder questions are **Q13-Q16** (Q8-Q12 are this registry's own, above). |

---

## Class B — posted wholesale lists (a price a state requires someone to publish)

| Source | URL | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|
| **New York SLA price postings** | `https://www.nyslapricepostings.com/public/price-lookup` (named by `https://sla.ny.gov/price-posting`) | web lookup | monthly; wholesale schedules due the 25th, two months ahead | public by statute | unstated | yes — the wholesaler and the posting month | **partial** | The SLA's own page confirms *"price schedules are publicly viewable"* and names the lookup URL. **The lookup itself returned an empty body to WebFetch** (twice, two paths) — a JS app, most likely. Prices, wholesaler-to-retailer, for the largest wine market in the US. **The single best class-B candidate found, and unverified** |
| **California ABC beer price posting** | `https://priceposting.abc.ca.gov/publicPricePosts`; data via `https://s7fcylvn8j.execute-api.us-west-2.amazonaws.com/prod/public/graphql` (AppSync) | SPA → GraphQL | continuous; new schedules effective on filing, amendments after 10 days | public; mandatory online filing since 2023-10-15 | app signs a 20s JWT per query; one request per county per day, identifying UA | yes — the filing licensee and the effective date (`effectiveDate`, epoch ms) | **yes** | **LIVE and parsed 2026-09-04.** The public search is a SPA; its data comes from an AppSync `public/graphql` endpoint whose queries are authorised by a JWT the app **signs in the browser** with a secret shipped in its own bundle (`REACT_APP_JWT_SECRET`). Reproducing that is the anonymous path the public uses — no login, no scrape. Fetched Santa Clara county (where the CA houses sit): `PricePostings` returns `manufacturer/product/tradeName/status/package/productSize{size,unit,containerType}/county/pricesTo/price/pricePromotion/containerCharge/effectiveDate`. Statuses `Active`/`Inactive`/`Old`; `pricesTo` `Retailers`/`Wholesalers`/`Manufacturers`; units ML/OZ/Gallon/Liter. **Parser: `apps/api-gateway/src/price-index/parse-california.ts`**; the earlier "TLS chain failure" was this environment lacking that host's CA cert — Node in the gateway has it. Fixture: 13 real rows, `california-abc-beer-2026-09-04.sample.json`. **Beer only** — but 3 of 14 tenants are in California |
| **Michigan LCC spirits price book** | `https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info`; editions at `…/lara/-/media/Project/Websites/lara/lcc/Price-Book/<M-D-YY>-PRICE-BOOK-EXCEL.xlsx` (and `-PDF.pdf`) | **Excel + PDF** (also NEW-ITEM-PRICE-LIST, RETAIL-PRICE-CHANGES, ADA-CHANGES, PRODUCTS-FROM-MI-MANUFACTURER, each in both) | **quarterly — MEASURED, 91 days** (14 archived editions 2022-01-30..2025-11-02, 8 of 13 gaps exactly 91; 2026-02-01 / 2026-05-03 / 2026-08-02). The NEW ITEM list is the four-weekly one (34 editions, modal gap 28) | no licence declared; michigan.gov's own footer asserts "Copyright State of Michigan" — unstated, recorded as unstated, never as permissive | n/a (nothing fetches it) | yes — `LICENSEE PRICE` per row, and the edition date **in the file name only** (no cell in the sheet carries one; `docProps` holds only the authoring day) | **no (fetch) / yes (one real edition, measured)** | **403 to this fetcher on 2026-09-05**, `server: AkamaiGHost`, on the info page, on `5-3-26-PRICE-BOOK-PDF.pdf` and on `robots.txt` itself, every reference sharing the edge-config hash `18.6353d117.*`; `dig` gives `www.michigan.gov -> edgekey.michigan.gov -> e4514.ksd.akamaiedge.net` — Akamai **Kona Site Defender**. Static Access-Denied body: no captcha, no JS challenge, no `Retry-After`. **`data.michigan.gov` is NOT a way round**: the state's Socrata portal answers this fetcher 200 and publishes `Disallow: /` for `User-agent: *`; nothing beyond its `robots.txt` was read. `www.legislature.mi.gov` 403s from its own WAF. **But `ars.apps.lara.state.mi.us` (LARA, Cloudflare) serves us normally, 200/130,880 bytes** — the block is host-specific, not state-wide. No S3/CDN/FTP/legislature/ADA mirror exists. **The book itself, measured in full** (2025-08-03 edition, 804,270 bytes, sha256 `ff592f82…`, via an Internet Archive capture; stdlib zip+XML reader): 12,795 rows = 3 header + 1 blank + 261 category headings + **12,530 product rows**, and **zero** defects — no missing size/pack/licensee price/brand, no licensee above base, no shelf below licensee, **no duplicate item codes** (Iowa published 2,308). `LICENSEE/BASE` median **0.949944**, band 0.9194-0.9773. Issuer's own definition: licensee price = base less a 17% licensee discount plus 4%+4%+4% specific taxes. **Class B and BUILT as an upload, not a fetch**: `price-index/parse-michigan.ts` + `POST /price-index/upload` (dry run by default, `PRICE_INDEX_UPLOAD_ENABLED` off, staleness gate, provenance = person + file name + sha256). Registry cadence corrected from `monthly`/62 days to `quarterly`/105 |
| **Connecticut DCP posted prices** | `https://biznet.ct.gov/DCPOpenAccess/LiquorControl/ItemList.aspx` | web list | monthly; wholesale posts by the 12th, effective the 1st | public by statute | unstated | yes | **no** | **WAF rejection** (*"The requested URL was rejected"*) to WebFetch. A commercial intermediary (`ctpricefile.com`) exists, which is itself evidence the data is not conveniently machine-readable |
| **Pennsylvania PLCB quarterly price listing** | `https://www.pa.gov/agencies/lcb/about-us/reports-and-publications/quarterly-price-listing` | **PDF only** | quarterly (Jan/Apr/Jul/Oct), back to 2016 | Act 39 of 2016 publication | unstated | yes — the report date is in the filename (`CRO000002_Report_20260701.pdf`) | **partial** | Page fetched; format and cadence confirmed. **Quarterly PDF is the wrong cadence and the wrong format** for a register whose comparison window is 30 days |
| **New Jersey ABC price posting** | `https://www.nj.gov/oag/abc/` | PDF orders | monthly, with administrative extensions | public | unstated | yes | **no** | Only reached indirectly (a 2023 administrative order extending posted prices surfaced in search). Not fetched |

---

## Class C — licensed distributor feeds (behind the house's own login; ADR 0114)

| Source | URL | Public prices? | API? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|
| **Provi / SevenFifty** | `https://www.provi.com/`, `https://go.sevenfifty.com/` | **no** — buyer pricing is behind a licensee account | No public developer API found | partial | Marketing pages confirm *"up-to-date pricing … from over 1,200 distributor portfolios"* and a 750,000-product database, all behind a buyer login. `provi.com/robots.txt` fetched: a HubSpot marketing config, nothing about the app |
| **Southern Glazer's Proof** | `https://shop.sgproof.com/`, `https://my.sgproof.com/s/registration` | **no** | none published | partial | Registration requires *being a current Southern Glazer's customer with an account number and a recent invoice number*. Same pricing online as through a rep |
| **RNDC (eRNDC)** | `https://app.erndc.com/login` | **no** | none published; support contact only | partial | Customer-only B2B ordering; pricing is per account |
| **LibDib** | `https://app.libdib.com/login`, `https://analyticsapi.libdib.com/login` | **no** — buyers upload a licence to shop | **An Analytics API exists** with Swagger (`/docs`) and Redoc (`/redoc`), behind a login | partial | The one distributor in this list that publishes API docs at all. The most promising class-C connection, and it needs the founder's licence |
| **Breakthru Beverage** | — | — | — | **no** | Not fetched this session. Recorded as unexamined, not as absent |

### Class C re-measured 2026-09-05 — and the finding is that there is nothing to connect (ADR 0126)

The rows above were written on 2026-09-04 from marketing pages and registration flows. Each was
re-measured on 2026-09-05 by reading what the portal itself publishes. **Four of the five change,
and one of them reverses.** Full transcript with status lines: `$SP/p4ar-fetch-log.md`.

| Source | Re-measured 2026-09-05 | What changes |
|---|---|---|
| **Breakthru Beverage (IL)** | `now.breakthrubev.com/` 200 → redirects to `/bbg/en/login` (SAP Commerce). **`now.breakthrubev.com/robots.txt` 200, 834 B: `User-agent: *` / `Allow: /bbg/en/login` / `Disallow: /`.** `breakthrubev.com/sitemap.xml` 200, 17,340 B — **60 `<loc>` entries enumerated in full, zero product/price/catalogue paths**. `/account-services`: "Breakthru Now — order anytime, anywhere … Browse our full product portfolio, view real-time pricing and deals" and no EDI, API or export named. Terms §6.2(c) forbids "web crawlers, data mining, scraping, robots, spiders" | From **unexamined** to **measured and forbidden**. The portal's own robots policy closes it to every automated reader but the login page |
| **Southern Glazer's Proof** | `shop.sgproof.com/robots.txt` 200, 791 B: allows all but cart/checkout/my-account, **and publishes `Crawl-delay: 10`, `Request-rate: 1/10`, `Visit-time: 0400-0845`** — honoured, and **no page on that host was fetched** because the request would have been at 12:18 UTC. `my.sgproof.com/robots.txt` returns `text/html` (a Salesforce shell), so no rules are readable from it. `southernglazers.com/terms-of-use` 200: forbids "any robot, spider, or other automatic device … including monitoring or copying any of the material", and separately **"agree not to provide any other person with access to this Website or portions of it using your username, password, or other security information"** | The credential clause is new and it is decisive: **declaring an SG Proof login to this product is itself the breach**, before any request is made |
| **RNDC (eRNDC)** | `app.erndc.com/login` 200, 10,966 B. `app.erndc.com/robots.txt` **404** — no rules, unrestricted per RFC 9309. `rndc-usa.com/robots.txt` 200, WordPress default. **No terms of use located**, so its position is recorded as **unstated**, never as permission | Unchanged in substance; the absence of a robots.txt is recorded as an absence, not as consent |
| **LibDib** | **`analyticsapi.libdib.com/openapi.json` 200, 70,801 B, sha256 `30e452d6…`. OpenAPI 3.0.2, 52 paths, 49 schemas. Counted over the whole document: `price` **0**, `cost` **0**, `catalog` **0**, `wholesale` **0**.** The one `Price` is the literal `"Price Bands"` in a propensity-model example. The paths are recommendation engines, telemetry, experiments and reseller depletion analytics | **REVERSED.** The 2026-09-04 row called it "the most promising class-C connection" from the existence of a Swagger page. The document was read: it is LibDib's internal ML portal and holds no price at all |
| **Provi / SevenFifty** | `provi.com/partnerships/encompass` 200: the integration is **distributor-ERP-side** and arranged by Provi's own sales team, who "complete the EDI setup". `go.sevenfifty.com/distributors/` 200: "Integrate with your ERP or RAS". **No buyer-facing API or developer documentation on either side** | Sharpened: Provi's "customer-specific pricing" reaches Provi *from* the distributor and stops there. A house cannot connect Provi to anything |

**What the industry actually ships to a venue, measured the same day.** This is the more useful
finding, and it is why ADR 0126 concludes there is no missing feed:

| Source | Fetched 2026-09-05 | What it says |
|---|---|---|
| `cleo.com/trading-partner-network/southern-glazers-wine-spirits` | 200 | SGWS EDI: **850 PO, 856 ASN, 810 Invoice, 997 Ack** |
| `truecommerce.com/trading-partner/southern-glazer/` | 200 | SGWS: **810, 850, 856** |
| both | — | **No EDI 832 price/sales catalogue on either page.** No beverage-alcohol wholesaler was found documented as sending one |
| `docs.restaurant365.com/docs/vendor-integrations-list` | 200, 3,077,923 B | Columns `Vendor / Multi-Invoice / Purchase Order / Order Guides`. **Southern Glazers, Republic National Distributing and Youngs Market each tick Multi-Invoice ONLY** — Order Guides blank for all three |
| `marginedge.com/bar-inventory` | 200, 103,853 B | **"We update your order guides based on your invoices, so you can track orders from start to finish in one place."** |
| `fintech.com/blog/alcohol-business-management-made-simple-…` | 200 | Two options: an "EDI file integration that seamlessly inputs all your **line-item invoice data**", or an electronic data file to upload. **No catalogue** |
| `help.marginedge.com/hc/en-us/articles/218400627-…-Order-Guides` | **403** to both fetchers, on a path its own `robots.txt` (200) permits | The order-guide help article was **not read**. Only the marketing page above was |

**Conclusion.** The buyer-side "distributor price list" in this industry is **derived from the
buyer's own invoices**. Mudavym already records those (ADR 0117 class A,
`procurement/own-paper-sighting.ts`). A class-C row, when one ever exists, is house-scoped and lands
on `vendor_price_observations` as `api_catalog` / tier 3 — never on `price_index_postings`, which has
no restaurant column and whose `restaurant_id IS NULL` rows are read by every house in the state.

**Two published EDI 832 implementation guides were fetched and are the parser's only spec**, since
neither the standard's summary pages nor any distributor publishes the segment positions:
CDW's X12/V4010/832 (55,216 B, sha256 `6d44bb14…`) and SPS Commerce's MSSS guide v2.6
(437,803 B, sha256 `06bee0d5…`), the latter carrying a real sample 832 now recorded verbatim as a
fixture. Provenance: `apps/api-gateway/src/distributor-feed/__fixtures__/EDI832-PROVENANCE.md`.

---

## Class D — retail references (never beside a vendor quote)

| Source | URL | Format | Terms | Rate limit | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|
| **Iowa Liquor Products** | `https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json` (303 → signed GCS) | **NDJSON**, no key | **CC BY 4.0** per `catalog.data.gov/dataset/iowa-liquor-products`; **attribution required**. `data.iowa.gov` itself 403'd, so the licence is cited from the federal mirror | none stated; one file per month is enough | **yes** | **13,762 rows, `report_as_of = 2026-09-01` on every one.** 100% coverage of price, `bottle_volume_ml`, `pack`, `upc`. 392 suppliers, 11,451 item numbers, 48 categories, **all spirits — no wine, no beer**. Median `state_bottle_retail / state_bottle_cost` = **exactly 1.50** (Iowa's markup). Our parser: **11,425 sightings, 2,337 refused** (2,308 duplicate item numbers, **29 rows where bottle cost × pack disagrees with the published case cost**), plus **11 rows publishing `bottle_volume_ml = 0`**. Fixture + proof: `scripts/fetch_price_sightings.py`; **ported to the gateway register 2026-09-04** as class D — `apps/api-gateway/src/price-index/parse-iowa.ts`, tested against the same fixture (20/24 fixture rows admitted, the 3+1 defects counted) so the two implementations cannot drift |
| **Oregon OLCC Monthly Pricing** | `https://data.oregon.gov/resource/vmf2-f83h.json` (Socrata; CSV/JSON/XML exports) | JSON array, no key | **No licence declared.** Metadata declares only `attribution: "Oregon Liquor & Cannabis Commission"` — unstated terms, not permissive terms | `robots.txt`: `Crawl-delay: 1`, `/resource/` not disallowed. Socrata: unauthenticated requests share a per-IP pool and get 429; a free app token gives 1,000 req/rolling hour | **yes** | **263,338 rows across all months; 3,856 for `asofdate = 2026-09-01`** (3,849 Aug, 3,839 Jul, 3,799 Jun). 21 columns including `asofdate`, `size`, `priceperunit`, `unitspercase`, `pricepercase`, `pricechange`, `priceperoz`. Spirits only. Our parser: **12/12 fixture rows admitted, 0 refused** — the cleanest file measured. **Ported to the gateway register 2026-09-04** as class D — `apps/api-gateway/src/price-index/parse-oregon.ts`, same fixture, `1.75 L → 1750 ml` |
| **Utah DABS product lists** | `https://abs.utah.gov/licenses-permits/off-premise-products/`, `.../shop-products/interactive-product-list/` | embedded table with CSV/Excel/Sheets export; monthly price books as PDF | not stated on the page | unstated | partial | Page fetched. The export is a **UI affordance** (*"hover over the Product Name column and click the three dots"*), not a URL — there is no documented machine endpoint |
| **Wine-Searcher trade API** | `https://www.wine-searcher.com/trade/api`, `.../trade/ws-api` | REST, XML or JSON | commercial licence; trial key on application | unstated | **no** | The pricing page returned **403** with `Retry-After: 0`. **Cost unmeasured.** The only broad wine-price source found; founder question Q5 |
| **Total Wine** | `https://www.totalwine.com/` | HTML | site terms not read | `robots.txt` fetched: product pages are allowed, but **`/search/` is `Disallow`** | partial | Which means there is **no permitted way to enumerate the catalogue** — you may read a product page you already know the URL of, and may not go looking. Retail price regardless |
| **Vivino** | `https://www.vivino.com/` | HTML | — | — | **no** | `robots.txt` could not be fetched: *"Unable to verify if domain www.vivino.com is safe to fetch"* from this environment. Named in `EXTERNAL_CONNECTIONS.md:153` as a host the code scrapes without the SSRF guard |
| **LCBO (Ontario)** | — | — | — | — | **no** | No official open API found. The best-known community mirror, `LCBOstats`, **sunset 2025-06-03** with data ending May 2025. AGCO publishes an open-data inventory (April 2026) but not prices |

### Merchant shops — the class-D sweep's own registry (measured 2026-09-05)

The founder's call of 2026-09-05, *"point it at merchant shops, as their own class"*, gave class D
a second kind of source: a retail shop's own shelf price, read off its markup, filed in
`price_index_postings` as `source_class = 'retail_reference'` and never beside a vendor quote.
The registry is a config file, `apps/api-gateway/src/vendor-intel/price-reference-shops.ts`, and the
reasons it is not a table are in ADR 0117 §"The sweep that reads merchant shops". Every row below is
one request per host, made on 2026-09-05 with `WineOpsBot/1.0 (+https://wineops.ai/bot; vendor price
intelligence)`. **Both flags default off and no shop has ever been fetched by the gateway.**

| Shop | Jurisdiction | Houses | robots.txt, 2026-09-05 | Where the price is | States a date? | Armed | Measured |
|---|---|---|---|---|---|---|---|
| **Berry Bros. & Rudd** | GB-ENG | 1 | **200, 1,502 B.** `*` disallows only /cart, /checkout, /my-account, /search, `/*?q=*`. Publishes **`Crawl-delay: 10`, `Request-rate: 1/10` and `Visit-time: 0200-0700`** — the only visit window in this register | schema.org `Offer` | **no** | yes | The window is honoured by `withinVisitWindow`. The two committed fixtures were fetched at 02:08Z, inside it; **this session wanted the host at 11:14:35Z and did not fetch it**. Named bots (Ahrefs, Semrush, Yandex, Amazonbot, CCBot, PetalBot…) are disallowed wholesale; WineOpsBot is not among them |
| **Slurp** | GB-ENG | — | **200, 3,628 B**, Shopify storefront file; `/products/` allowed | schema.org `Offer` | **no** — states only `priceValidUntil`, and publishes it as `"2027-09-5"` (single-digit day) | yes | The header carries prose addressed at shopping agents (a UCP/MCP endpoint, a Shopify skill URL, "Checkouts are for humans"). Third-party text, read as **data**: nothing in it was acted on, and this sweep never reaches a cart |
| **Tanners Wines** | GB-ENG | — | **200, 3,660 B**, Shopify storefront file | schema.org `Offer` + og | **YES** — `validFrom` 2026-09-05, `priceValidUntil` 2026-12-04 | yes | **The only shop of the six measured that states when its price applies.** The one page admitted by the reader: GBP 35.00, 750 ml, per bottle |
| **Hedonism Wines** | GB-ENG | — | **200, 3,624 B**, Shopify storefront file | schema.org `Offer` + og | no | **no** | Serves `priceCurrency: USD` and `og:price:currency: USD` to an anonymous fetcher, on a London shop. A USD figure on a GB index line is not the UK shelf price, so it is **refused** (`currency_not_jurisdiction`) until the presentment currency can be pinned |
| **Hi-Time Wine Cellars** | US-CA | 3 | **200, 1,674 B, `Crawl-delay: 10`**; the BigCommerce transactional paths disallowed, product pages allowed | **microdata + Open Graph only** — its single JSON-LD block is a `BreadcrumbList` | no | yes | `/pommery-brut-royal-354430`, 138,070 B: `itemprop="price" content="54.99"`, `product:price:amount` 54.99, `product:price:currency` USD, `og:price:standard_amount` 59.95 (the was-price). **The shop that made the microdata step of the precedence necessary.** `/xmlsitemap.php?type=products` is a permitted enumeration route and returned 1,154,767 B |
| **K&L Wine Merchants** | US-CA | — | **403 to robots.txt itself** (5,606 B challenge page) | unknown | unknown | **no** | Re-measured; the same result as 2026-09-04. Its crawl rules cannot be read, so nothing may be fetched |
| **Binny's Beverage Depot** | US-IL | 3 | **200, 297 B**; disallows /search and two API paths, advertises two sitemaps | unknown | unknown | **no** | The advertised `Sitemap.xml` answered **HTTP 403** with a Cloudflare "Attention Required!" body (4,574 B) to the same agent minutes later. **Illinois (3 houses) has no readable merchant shop today** |
| **Merchant's Fine Wine** | US-MI | 3 | **200, 1,248 B — and no directives at all**: 24 lines, every one a comment. The Cloudflare content-signals preamble (`search` / `ai-input` / `ai-train`) with **no signal stated**, plus an express Article 4 reservation under EU Directive 2019/790 | unknown | unknown | **no** | Its own rule (c) applies: with no signal, permission is *"neither granted nor restricted"*. Unstated terms are recorded as unstated. **No page was fetched.** Michigan is the estate's best-covered state and its one readable merchant robots.txt declines to say |
| **Kavaklıdere** | TR | 2 | **200, 293 B**; `*` allowed everything but /wp-admin/, and **`Google-Extended`, `GPTBot` and `CCBot` disallowed by name** | none found | n/a | **no** | Homepage 170,717 B with **zero** occurrences of the lira sign, "TL", "fiyat" or a cart — what Law 4250 art. 6 and md. 11/1 predict (unverified at primary source; see §Türkiye). The two Türkiye houses have no merchant-shop line |
| **Wine Chateau** | US-NJ | **0** | 200, 3,622 B after a 301 www→apex; Shopify storefront file | schema.org `Offer` + og | no | **no** | Registered and not fetched because it **serves no house**: the register scopes by state at read time and no tenant is in NJ. Also the page that proved the title trap — it publishes **three** `og:title` values and the first is the shop's slogan, *"Buy Wine Online - WineChateau® for Fine Wines"* |

**Update 2026-09-05 — the date rule changed, and the numbers with it.** The founder answered
ADR 0117 Q27 (*"Yes: an `issued_at_basis` column, fetch-dated rows labelled and aged from the
read"*), so a shop page that states no date is no longer refused: it is filed under the day we
read it with `issued_at_basis = 'fetch_date'`, `refuseStale` ages such a row from that read
rather than from an edition it never had, and the index line prints **"read on"** for it and
**"issued"** only for a shop that published a date. The "States a date?" column above is
therefore a statement about the shop, not about admission — a `no` now costs the row its
"issued" wording, not its place in the register. Measured again on the same six fixtures:
**4 of 6 admitted** (3 `fetch_date`, 1 `issuer_stated`), `no_issue_date` down from 3 to 0, and
the two remaining refusals unchanged (`identity_conflict`, `currency_not_jurisdiction`).

**What the sweep does with them.** `apps/api-gateway/src/vendor-intel/shop-reference-posting.ts` reads
the price in the precedence *schema.org `Offer` (bound to a product node whose identity matches the
page) → microdata `itemprop="price"` → Open Graph*, takes the size from `readBottleSize` unchanged,
and refuses rather than guesses. Measured on the six committed fixtures: **4 admitted, 2 refused** —
one `identity_conflict` (the Dom Pérignon page whose only JSON-LD block is Caol Ila whisky at
GBP 225) and one `currency_not_jurisdiction`. The register the rows enter is
`price_index_postings`, which `belowTrailingAverage` does not read at all.

---

## Class E — public indexes

| Source | URL | Format | Cadence | Terms / key | Rate limit | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|
| **USDA My Market News (MARS API)** | `https://marsapi.ams.usda.gov/services/v1.2` | JSON | daily for terminal markets | **API key required** — measured. Search results describe the key as free on signup at `mymarketnews.ams.usda.gov/mymarketnews-api`; **that page was never reached, so "free" is second-hand and not verified** | not read | **partial** | The API base returned **403** unauthenticated — the key requirement is confirmed by measurement. **Every documentation page on `mymarketnews.ams.usda.gov` timed out (60s) across four attempts and four paths**, so the terms, formats and limits are **unread and not asserted here**. This is the source the brief named as a first candidate; it is the one that could not be verified |
| **USDA AMS legacy report files** | `https://www.ams.usda.gov/mnreports/bh_fv020.txt` | fixed-width text | **frozen** | — | `ams.usda.gov/robots.txt` returned 403 | **yes — and this is the warning** | **HTTP 200, carrying a report headed "BOSTON Terminal Prices as of 03-JAN-2024" — 975 days stale**, announcing its own migration to MARS only in prose in the body. **Do not fetch this path.** It is the reason ADR 0117 requires a staleness gate keyed on the issuer's date |
| **BLS Public Data API** | `https://api.bls.gov/publicAPI/v1/timeseries/data/` | JSON | monthly | **v1 needs no key**; v2 needs free registration, renewed annually | **v1: 25 queries/day, 25 series, 10 years. v2: 500/day, 50 series, 20 years. Both: 50 requests per 10 seconds** | partial | Limits read from `bls.gov/developers/api_faqs.htm` and quoted exactly. No series pulled this session. PPI series for beverage merchant wholesalers are the relevant ones |
| **USDA ERS** | `https://www.ers.usda.gov/` | — | monthly / annual | — | — | **no** | Not fetched this session. Recorded as unexamined |

---

## Sources deliberately not pursued

- **Third-party scraping resellers** (Apify actors for USDA/LCBO/Wine-Searcher, and the
  several "LCBO data API" vendors) — they resell someone else's terms. A sighting whose
  provenance is *"a scraper we paid"* fails ADR 0117's issuer test.
- **Washington State** — spirits retail was privatised in 2012; there is no state posted
  list to read.
- **Illinois** — 3 tenants, and **no price-posting regime exists to publish against**. Measured
  2026-09-05 from three primaries: **235 ILCS 5/6-19** reads in full *"Sec. 6-19. (Repealed).
  (Source: P.A. 82-783. Repealed by P.A. 90-432, eff. 1-1-98.)"*; **11 Ill. Adm. Code 100**, the
  Commission's own rules, read whole (216,637 bytes, 2,148 lines) has **53 distinct section headings
  and not one contains "price", "posting" or "schedule"** — all 16 body occurrences of "price" are
  trade-practice rules; and **Article VI**'s only "schedule of the prices" is 235 ILCS 5/6-28, a
  retailer's own drink list at its own bar (happy hours). The ILCC's Statutes and Rules page links to
  the Act and two administrative codes and nothing else. Illinois hosts do **not** block us
  (`ilcc.illinois.gov` has no robots.txt and served us; `tax.illinois.gov` served us) — there is
  nothing to fetch. `GET /price-index/US-IL` now says why, with the statute, instead of "until one is
  found".

## What the estate actually needs

Production holds **14 restaurants**: 3 Michigan, 3 Illinois, 3 California, 2 Türkiye,
1 United Kingdom, 2 with no state recorded. (The column is free text and holds both `MI`
and `Michigan`, and `United States` / `united States` / `USA` / `US` — a source registry
keyed on jurisdiction cannot join to it as it stands. Filed as a gap.)

So of everything above: **Michigan and California are the only jurisdictions where a
class-B source exists for a house we actually have**, and both refused this environment's
fetcher today. The two sources that parsed perfectly — Iowa and Oregon — serve **zero**
tenants and are class D. That asymmetry is the finding, and it is why ADR 0117 puts the
house's own paper first.

---

## Türkiye and the United Kingdom, 2026-09-04

ADR 0117 §Founder-only questions Q4 asked whether a permanent em dash is acceptable for the
two Türkiye houses and the one UK house, which sit outside all five source classes. The
founder's answer, 2026-09-04: **"research their markets separately."** This is that research.
Same convention as the tables above — `yes` means bytes were fetched and read today, `partial`
means something adjacent was measured, `no` means the fetch failed and the reason is stated.
**A source this environment could not fetch is unverified, never unavailable.**

The finding, stated first: **neither market has a class B at all, and the reason is structural
rather than incidental.** Class B exists in the United States because a three-tier licensing
system compels a wholesaler to *publish* the price it charges a retailer. Türkiye has no such
compulsion and an active statutory ban on the opposite side; the UK abolished the concept with
resale price maintenance. What each state *does* publish is **the tax** — exactly, per unit,
on a stamped date, revised on a stated cadence. For these three houses the tax is the only
government number that carries all five of ADR 0117's admission facts, and it is not a price.

### Türkiye

**Who regulates.** The brief's phrase "TAPDK/TİTCK-era" is out of date. TAPDK was dissolved
24 December 2017 and its powers went to the Ministry of Agriculture and Forestry, where they
sit today as the **Tütün ve Alkol Dairesi Başkanlığı (TADB)** —
`https://www.tarimorman.gov.tr/TADAB`, fetched today, live, and it lists an e-bildirge system,
the ATİP alcohol trade platform and a statistics link. **It publishes no alcohol price data.**
Its "Resmî İstatistikler" page (`.../TADAB/Link/38/Resmi-Istatistikler`, fetched today) holds
**fuel bioethanol statistics only**, 2011–2026, quarterly PDFs — zero alcoholic-beverage
datasets. TİTCK is the medicines and medical-devices agency and does not appear anywhere in
this chain; `titck.gov.tr` was not fetched this session and is recorded as unexamined.

**Why no distributor publishes a trade price list.** Law 4250 Article 6 bans advertising,
promotion and sales campaigns for alcoholic beverages, and the sales-and-presentation
regulation (md. 11/1) bans establishing any consumer-facing sales system via information-society
services or mail order — i.e. **online alcohol sale is unlawful in Türkiye**. Both were reached
only through search summaries and secondary legal commentary today: `mevzuat.gov.tr` failed DNS
(`ENOTFOUND`), `www.mevzuat.gov.tr` failed TLS chain verification, and the TADB copy of the
trade regulation (`7.5.6203-yonetmelik.pdf`, 756 KB, fetched today) extracted as compressed
streams with no readable article text. **The legal claims in this paragraph are therefore
recorded as unverified-at-primary-source**, and the measured evidence is the behaviour they
predict: every producer site below is age-gated and priceless.

| Source | URL | Class | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|---|
| **GİB — ÖTV (III) sayılı liste, (A) cetveli** | `https://cdn.gib.gov.tr/api/gibportal-file/file/getFileResources?objectKey=…/31122025_3sayili.pdf` | **E (tax, not a price)** | PDF (text extractable) | six-monthly, Jan + Jul (Law 4760 md. 12/3, Yİ-ÜFE) | state publication; `gib.gov.tr/robots.txt` fetched: `User-agent: *` / `Allow: /`, no crawl-delay, no disallow | unstated | yes — header reads *"[10799 sayılı Cumhurbaşkanı Kararı ile değişen liste] (Yürürlük: 31/12/2025)"* | **yes** | **Read in full.** Asgari maktu vergi tutarı, TL: **beer 2203.00 = 12,4849 at a 63% rate**; **still wine 22.04 = 61,3914 at 0%**; sparkling 2204.10 = 414,7770; vermouth ≥22% = 1.919,1384; **spirits 22.08 / gin / vodka / liqueur = 1.919,1384**; **rakı 2208.90.48.00.11 = 1.705,9025**; fermented others 2206.00 = 135,4355. **Alcohol is in (A), not (B)** — the brief's "(B) cetveli" is tobacco. **The unit is not stated on the face of the table and is NOT asserted here:** press reporting of the same decision divides by 100 (*"19,19 lira per degree of alcohol per litre"*, *"rakılarda 17,06"*), which implies the tabled figure is per litre of pure alcohol; that inference was not confirmed against Law 4760 and is exactly the ambiguity ADR 0117's unit rule exists to refuse |
| **Resmî Gazete (the decrees themselves)** | `https://www.resmigazete.gov.tr/eskiler/2026/07/20260703M1.pdf` | E | PDF | per decree | public | unstated | yes | **no** | **TLS chain verification failed** from this environment, twice (the PDF and `/robots.txt`). Read indirectly: the 3 July 2026 decree **11489** (RG 33299 mükerrer) was fetched via `alomaliye.com` and **changes only the (B) cetveli — tobacco**; it also disapplies md. 12/3 for July–December 2026. **So the alcohol schedule in force is still the 31/12/2025 one above** |
| **TADB (regulator)** | `https://www.tarimorman.gov.tr/TADAB` | — | HTML | — | public | unstated | n/a | yes | Live. E-bildirge, ATİP, mevzuat, tender notices. **No price list of any kind.** Statistics page holds bioethanol only |
| **Mey\|Diageo Türkiye** | `https://www.diageoturkiye.com/` (301 from `meydiageo.com`) | C | HTML | — | — | — | n/a | yes | **Age gate first** (*"Bu siteye giriş yapabilmeniz için 18 yaşından büyük olmak zorundasınız"*). Behind it: brands, sustainability, careers. **No prices, no price list, no bayi portal** |
| **Doluca** | `https://www.doluca.com/` | C | HTML | — | — | — | n/a | yes | **Age gate is the entire page** (*"18 YAŞINDAN BÜYÜK MÜSÜNÜZ?"*). Nothing else reachable. No prices, no shop, no dealer portal |
| **Kavaklıdere** | `https://www.kavaklidere.com/` | C | HTML | — | — | — | n/a | yes | Age gate; then history, vineyards, a products section. **No prices, no shop, no fiyat listesi, no bayi portal** |
| **Anadolu Efes** | `https://anadoluefes.com.tr/` (301 from `anadoluefes.com`) | C | HTML | — | — | — | n/a | yes | **No age gate** on the corporate site — and **no product prices and no dealer portal** either. Investor Relations and a sustainability report; a listed company's financials are not a price list |
| **Bizim Toptan** | `https://www.bizimtoptan.com.tr/` | D | HTML | continuous | `robots.txt` fetched: `Allow: /`, `Disallow: /cart`, `/checkout`, `/login`, `/order/`, and the filter params `*orderby*`, `*pagesize*`, `*price*`; several bots blocked by name | **no crawl-delay declared** | prices carry no published-on date on the card | **yes** | **Prices ARE visible to an anonymous visitor** — e.g. *"Ülker Çikolatalı Gofret 36 g 36'lı — 518,40 TL"*, *"Beypazarı Sade Maden Suyu 200 ml 6'lı — 61,00 TL"*. **But no alcohol**: the homepage categories run tea, coffee, water, juice, soft drinks and stop. Not an exhaustive catalogue crawl — homepage only |
| **Metro Türkiye "Güncel Fiyatlar"** | `https://guncelfiyatlar.metro-tr.com/` | D | HTML | claims "current" | **`robots.txt` fetched today: `User-Agent: *` / `Disallow: /` / `Noindex: /`** | n/a — **crawling is refused outright** | — | **no, and must stay no** | The named page `/AlisverisListesi` returned **404**, and the site disallows everything anyway. `www.metro-tr.com/robots.txt` separately returned **403**. **A polite fetcher may not read this source at all** — the most promising-looking Turkish wholesale price surface is closed by its own rule |
| **Migros Toptan** | `https://www.migrostoptan.com/` → `migroskurumsal.com` | D | HTML | — | — | — | — | **no** | `www.migrostoptan.com` **fails certificate validation** (cert altnames are `*.migroskurumsal.com` only). The corporate site names *Migros Toptan* and *Migros Toptan Pro* as brands but exposes **no catalogue and no prices** to an anonymous visitor |
| **Migros retail (sanalmarket)** | `https://www.migros.com.tr/` | D | HTML | continuous | `robots.txt` fetched: **`Disallow: /arama`** (search) and `/*espv`; product and category pages are **not** disallowed; sitemap at `/hermes/api/sitemaps/sitemap.xml` | no crawl-delay | no published-on date | partial | Same shape as Total Wine in the class-D table above, with one difference: **the sitemap is a permitted enumeration route**, so a catalogue sweep is possible without touching `/arama`. Moot for drink: **online alcohol sale is unlawful in Türkiye**, so no alcohol price will appear here |
| **Hal Kayıt Sistemi (HKS) — Ticaret Bakanlığı** | `https://www.hal.gov.tr/Sayfalar/FiyatDetaylari.aspx` | **E (and the best Turkish source found)** | HTML table with an export control | **daily** | state publication; **`/robots.txt` returned 404** — no crawl rules are served at all | unstated | **yes** — *"bulletin dated 4 September 2026, using data from 3 September 2026"* | **yes** | **Public, no login, live today.** National daily wholesale produce prices from the toptancı halleri. Columns: *Ürün Adı · Ürün Cinsi · Ürün Türü (Konvansiyonel / İyi Tarım / Organik) · Ortalama Fiyat · İşlem Hacmi · Birim Adı (Kg, Adet)*. Sample row read: **`ACUR` · `ACUR` · `Konvansiyonel` · `24,97` · `71.997 Kg`**. Carries its own disclaimer: *"for informational purposes only; there may be inaccurate values due to human error or technical malfunction"*. **Produce, not drink.** Export offered as "Aktarma Seçenekleri" (current page / all pages), format not declared on the page |
| **İBB Açık Veri — Hal Ürünleri ve Fiyatları Web Servisi** | `https://data.ibb.gov.tr/dataset/hal-urunleri-ve-fiyatlari-web-servisi` | E | REST API (Swagger) | dataset page says last updated **2022-04-04**; cadence not stated | **İstanbul Büyükşehir Belediyesi Açık Veri Lisansı** — named on the page, full text not read | not stated | via the API payload, unread | **partial** | Dataset page read. The Swagger UI at `https://halfiyatlaripublicdata.ibb.gov.tr/swagger/ui/index` loads as an **empty Swagger shell** — no spec; `/swagger/docs/v1` hung up the socket and `/swagger/v1/swagger.json` returned **404**. **The API is recorded as unverified**, and the four-year-old "last updated" is a reason to prefer HKS |
| **TÜİK — TÜFE / Yİ-ÜFE** | `https://veriportali.tuik.gov.tr/` (302 from `data.tuik.gov.tr`) | E | portal + token-signed file downloads | monthly, on a published release calendar | `robots.txt` fetched: `Allow: /`, and it **names `anthropic-ai`, `Claude-Web`, `ClaudeBot`, `ClaudeUser`, `Claude-SearchBot` in an explicit allow group** — the only source in this whole register that permits us by name | none declared | yes — TÜİK stamps its bulletins | **partial** | The portal is a JS application: `/Kategori/GetKategori?p=enflasyon-ve-fiyat-106` returned an **empty body** to WebFetch, the same failure mode as the NY SLA lookup. Download URLs are token-signed (`/api/tr/data/downloads?t=r&p=<token>`), so **there is no stable series URL to poll**. Index only — never a price for a named product |
| **TCMB EVDS** | `https://evds3.tcmb.gov.tr/` (302 from `evds2`) | E | JSON / CSV / XML over REST | monthly for price series | free account, then an API key from the profile page; **terms not read** | **not read** | yes | **partial** | The site is a JS shell — both `/` and `/sorular` returned bare headers to WebFetch. Key acquisition and the free tier are **second-hand from search results, not measured**. Recorded as unverified. It is the cleanest route to a Turkish index line *if* the key terms turn out to permit it |

### United Kingdom

**There is no class B and there cannot be one.** The UK has no price-posting regime: no
wholesaler is required to publish what it charges a licensee. Every wholesaler measured today
puts its prices behind a trade account, without exception. What the state publishes is the
**duty**, and unlike almost everything else in this register it is exact, dated, unit-stamped
and openly licensed.

| Source | URL | Class | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|---|
| **HMRC alcohol duty rates** | `https://www.gov.uk/guidance/alcohol-duty-rates` | **E (tax, not a price)** | HTML | on change; last changed **1 February 2026** (page first published 23 August 2023) | **Open Government Licence v3.0** | unstated | **yes** — the page states its own effective date and last-updated date | **yes** | **Read in full, rates in force from 1 February 2026, £ per litre of pure alcohol.** Beer: 0–1.2% £0.00 · 1.3–3.4% £9.96 · 3.5–8.4% **£22.58** · 8.5–22% £30.62 · >22% £33.99. Still cider 3.5–8.4%: £10.39. **Wine, spirits, sparkling cider and other fermented products 3.5–8.4%: £26.61**; 8.5–22% **£30.62**; >22% **£33.99**. Draught relief: £8.58 / £8.95 / £19.45. **No CSV and no API on the page** — the rates are HTML prose |
| **WSTA** | `https://wsta.co.uk/`, `https://wsta.co.uk/data-hub/` | — | reports | — | **members only** | — | — | **yes (as a negative)** | The Data Hub is **sales volume and value, consumer trends, vintage reports — no price index**, and it is closed: *"All data not to be shared outside of WSTA member organisation."* Its numbers are other people's (NIQ, CGA, Kantar, Savanta, Canvas8, KAM), so even a member could not put them on a tenant's screen. **Not a price source** |
| **Matthew Clark / MCB Drinks** | `https://www.mcbdrinks.co.uk/` (301 from `matthewclark.co.uk`) | C | HTML | — | trade account | — | — | **yes** | **Prices behind a customer login** (`shop.mcbdrinks.co.uk/login.aspx`); new customers go through `/electronic-application-form`. No public price list, no catalogue download, no API |
| **LWC Drinks** | `https://www.lwc-drinks.co.uk/` | C | HTML | — | trade account | — | — | **yes** | **Pricing behind an online-ordering account**; a public "View our range" catalogue exists **without prices**. No API |
| **Bidfood** | `https://www.bidfood.co.uk/` | C | HTML | — | MyBidfood account; `robots.txt` fetched: `User-agent: *`, `Disallow:` (empty) — **nothing disallowed**, sitemap at `/sitemap_index.xml` | no crawl-delay | — | **partial** | Sells alcohol ("Alcohol – Unity Wines"). **No prices on the public site**; ordering is through MyBidfood. The public range at `bidfooddirect.co.uk/public/` returned **403** to this environment, so whether that surface shows prices is **unverified**. Note the asymmetry worth recording: robots.txt permits everything, and there is simply nothing priced to read |
| **Brakes** | `https://www.brake.co.uk/` | C | HTML | — | — | — | — | **no** | **HTTP 502** from this environment. Unexamined, not absent |
| **Venus Wine & Spirit Merchants** | `venuswine.co.uk`, `venusplc.com` | C | — | — | — | — | — | **no** | **All three hostnames failed DNS** (`ENOTFOUND` on `www.venuswine.co.uk`, `www.venusplc.com`, `venusplc.com`). Search results place the company at `venusplc.com` and record that **Booker Group (Tesco) acquired it in June 2024** — so it is now inside Booker, below |
| **Booker** | `https://www.booker.co.uk/` | C | HTML | — | membership | — | — | **no** | **HTTP 403.** The one UK wholesaler that might plausibly show prices to a member without a per-account price file, and it refused this environment. **Unverified** |
| **ONS — consumption segment indices and price quotes** | `https://www.ons.gov.uk/economy/inflationandpriceindices/datasets/consumerpriceindicescpiandretailpricesindexrpiitemindicesandpricequotes` | D/E | **CSV + XLSX** | **monthly** — latest edition July 2026, released 19 August 2026, next 16 September 2026 | **Open Government Licence v3.0** | unstated | yes — edition month and release date | **yes** | **And this is the UK's version of the `bh_fv020.txt` warning, inverted.** The page states: *"From March 2026, the existing price quote data will be updated to exclude individual price quote information for COICOP Divisions 1 and 2."* Division 2 is alcohol and tobacco. **The item-level price quotes for alcohol are gone as of March 2026** because scanner data was integrated. The **indices remain**; the individual quotes do not. A fetcher written against last year's file would still get 200s and a well-formed CSV — with the alcohol rows silently missing |
| **ONS time series (JSON)** | `https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7bv/mm23/data` | E | **JSON** | monthly | OGL v3.0 | unstated | yes — carries `updateDate` per observation | **yes** | **Fetched and read.** `d7bv` = *CPI INDEX 02: ALCOHOLIC BEVERAGES, TOBACCO & NARCOTICS, 2015=100*. Top-level keys `years` / `quarters` / `months`; **latest month June 2026 = 159.6, `updateDate` 2026-07-21**. A stable, keyless, per-series URL — **the cleanest index endpoint in this entire register.** Companion series: `cjuz` (CPI weights 02.1, alcoholic beverages) |
| **Defra — wholesale fruit and vegetable prices** | `https://www.gov.uk/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average` | **E — and the only source found for either house that carries all five admission facts and is openly licensed** | **CSV** (plus ODS) | **fortnightly**; latest 1 September 2026 | **Open Government Licence v3.0** | unstated | **yes — a date on every row** | **yes** | **Fetched and parsed.** `https://assets.publishing.service.gov.uk/media/6a918dd7f5b35599aec18f5b/fruitvegprices-260901.csv`, headers exactly `category,item,variety,date,price,unit`. Sample rows read verbatim: `fruit,apples,bramleys_seedling,31/08/2026,1.37,kg` · `vegetable,beans,dwarf_french_or_kidney,31/08/2026,5.8,kg` · `fruit,strawberries,strawberries,31/08/2026,3.82,kg`. Dates 08/11/2024 → **31/08/2026**. Units `kg`, `head`, `stem`, `twin`. England and Wales; Birmingham, Bristol, Manchester and a London market. **Wholesale, home-grown horticultural produce — not drink** |
| **AHDB** | `https://ahdb.org.uk/markets-and-prices` | E | Excel / dashboards | weekly | **redistribution prohibited — quoted verbatim below** | `robots.txt` fetched: `Allow: /`, `Disallow: /Query/`, no crawl-delay | yes | **yes (as a negative)** | Deadweight cattle, sheep and pig prices; farmgate and wholesale milk; cereals and oilseeds; fertiliser, fuel, hay. **Alcohol out of scope.** And the terms close it: *"You must not provide this information to any other third parties, including further publication of the information, or for commercial gain in any way whatsoever without the prior written permission of AHDB for each third party disclosure, publication or commercial arrangement"*, use limited to *"internal business purposes only"*. **Showing an AHDB number on a tenant's screen is third-party publication.** Not usable in the product without a written AHDB permission |
| **Liv-ex** | `https://www.liv-ex.com/` | D | — | continuous | **membership, price not published** | — | yes | **yes (as a negative)** | **Fine wine only** — no spirits, no beer, and nothing a restaurant buys by the case for service. 26 years of transaction prices, live bids and offers, and the LWIN identifier standard, **all behind membership**; the site quotes no fee (*"a bespoke offering to suit your business needs"*) and **mentions no API**. The founder's framing is confirmed by measurement |
| **Wine-Searcher trade API** | `https://www.wine-searcher.com/trade/api` | D | REST (XML/JSON) | — | commercial licence | — | — | **no** | **Unchanged from the class-D table above: 403 with `Retry-After: 0`, cost unmeasured.** See the status row below — the founder is requesting a quote |
| **UK supermarket retail** | `tesco.com`, `sainsburys.co.uk`, `waitrose.com` | D | HTML | — | site terms not read | — | — | **no** | **`tesco.com/robots.txt` 403 · `sainsburys.co.uk/robots.txt` 403 · `waitrose.com/robots.txt` timed out at 60s.** Not one UK grocer's crawl rules could be read today. **Until a robots.txt is actually read, no UK retail sweep may be written** — and even then it is a retail line, in its own register, never beside a vendor quote |

### Wine-Searcher — status, 2026-09-04

| Source | URL | Class | If bought | Verified | Status 2026-09-04 |
|---|---|---|---|---|---|
| **Wine-Searcher trade API** | `https://www.wine-searcher.com/trade/api` | **D — retail reference** | **A retail line only: its own register, labelled as retail, never beside a vendor quote** (ADR 0111's separate-register rule; ADR 0117 class D) | **no** | **The founder is requesting a quote himself.** The pricing page returned **403 with `Retry-After: 0`** on fetch, so **the cost is unmeasured and stays unmeasured until the quote arrives.** Nothing about the class changes if it is bought: broad wine coverage does not turn a consumer-facing reference into a wholesale quote |

### What a house's own paper can do first — and the defect that stops it

Class A needs no vendor, no terms and no network, so it is the obvious first fill for all three
houses. **It is currently wrong for exactly these three houses, and only for them.**

- `price_history` — the table both own-paper writers feed — **has no currency column at all**
  (`supabase/migrations/20260805000000_baseline_from_production.sql:4274-4287`).
- Neither call site passes one: `procurement.service.ts:3221` (receipt verified) and `:4764`
  (order confirmed) build a `sighting` object with `unitPrice`, `unitLabel`, `packSize`,
  `unitVolumeMl` and `observedAt` — **and no `currency`**.
- So the default fires: `apps/api-gateway/src/procurement/own-paper-sighting.ts:276` reads
  `const currency = (input.currency ?? "USD").toUpperCase();`, and
  `vendor_price_observations.currency` is itself
  `character varying(3) DEFAULT 'USD' NOT NULL`
  (`…20260805154027_vendor_price_observations.sql:82`).
- **Every class-A sighting the two Türkiye houses and the UK house produce is therefore stamped
  USD.** A TRY invoice and a GBP invoice both land labelled USD.
- And the guard cannot see it. `price-below-average.ts:187-192` refuses a group whose rows
  disagree on currency — *"Converting would require an FX rate nobody recorded; a saving stated
  in a rate we invented is a fabricated saving."* That is exactly right, and it is **blind to a
  group that agrees on the wrong currency.** The absence of a currency is reported as a
  currency.

**The fix needs no migration.** `public.restaurants` already carries
`currency character varying(3) DEFAULT 'USD'`
(`…20260805000000_baseline_from_production.sql:3576`). Passing the tenant's own value into the
`sighting` object at both call sites closes it — and `own-paper-sighting.ts` should **refuse**
rather than default when it is absent, the way it already refuses an absent `observedAt`
(*"stamping it with now() would make an old price look like today's"* — `:266-273`). The same
sentence applies to money.
**Not measured this session:** whether the three non-US tenants actually carry `TRY` and `GBP`
in `restaurants.currency`, or whether they too are sitting on the `'USD'` default. That is the
first thing to check before writing a line of code, and it is a read, not a write.

### What the market-box sentence should say for these houses today

Not an em dash, and not silence dressed as calm. The box knows something specific about these
three houses that it does not know about the eleven US ones, and saying it is more useful than
saying nothing:

> **Türkiye** — no market comparison. Turkish law bans alcohol price advertising and online
> sale, so no distributor or marketplace publishes a trade price. Your own invoices are the
> only price register available here. The ÖTV schedule (GİB, in force 31/12/2025) is shown
> separately as tax, not as a price.

> **United Kingdom** — no market comparison. The UK has no price posting; every wholesaler
> quotes per account. Your own invoices are the only price register available here. HMRC duty
> (in force 1 February 2026) is shown separately as tax, not as a price.

Both sentences name a cause, name what would fill the gap, and label the tax line as a tax.
Neither claims a number the house does not have.

### Recommendation

**Fill class A for all three houses, fix the currency defect before a single row is written,
and add one new labelled line — the duty line — rather than a new source class.** The duty line
is not a price and must never be shown as one, but it is the only number in either market that
is exact, per product, dated, unit-stamped, openly licensed and computable from data the house
already holds: for the UK, ABV band → £ per litre of pure alcohol × volume × ABV; for Türkiye,
the ÖTV asgari maktu for the G.T.İ.P. class. It answers a question the house actually asks —
*how much of this bottle is tax* — without pretending to answer one it cannot. Beyond that,
**buy nothing and open no Turkish distributor account**: every Turkish trade portal measured
today is closed by statute rather than by preference, so an account would not unlock a price
list that exists; and every UK trade portal is per-account pricing, which is class C — a
connection the house declares under ADR 0114, not a source this registry can hold.

**The strongest counter-argument, and it is a good one:** the duty line is a *derived* number,
and ADR 0117 exists precisely to stop derived numbers entering the register. Computing
"£26.61 × 0.75 L × 13.5%" produces £2.69 that no issuer ever published for that bottle — the
issuer published a rate, and the house published the ABV and the volume, and neither published
their product. That is arithmetic wearing a citation. It also inherits every error in the
house's own ABV and volume data, which is the least-verified data in the ledger, and it will be
read as authoritative because it carries a government name. If the founder accepts that, the
duty line must carry **its own provenance triple** — the rate's issuer and effective date, plus
the house's own ABV/volume and where they came from — and must be refused outright when either
half is missing, exactly as a sighting is. If the founder does not accept it, the honest
alternative is to publish only the *rate schedule* (a table, not a per-bottle number) and let
the person do the multiplication, which loses most of the value but invents nothing. **This is
a genuine fork and it is the founder's, not an agent's.** Recorded as Q9 below.

### Founder-only questions raised by this research

Numbered to continue ADR 0117's own list, which ends at Q7. These five live here rather
than being copied into the ADR, so there is one place to answer them.

8. **Is a Turkish distributor account worth opening?** Measured answer: **no, and not for the
   usual reason.** Mey|Diageo, Doluca, Kavaklıdere and Anadolu Efes publish no prices to anyone
   online, and Law 4250 md. 6 plus the sales regulation md. 11 appear to make publishing them
   unlawful rather than merely unattractive. An account would get a rep and a PDF by email — a
   class-A quote once it lands on the house's own paper, which is where it already goes. **Do
   you want an agent to confirm the statutory position at primary source before this is
   recorded as settled?** Both primary hosts (`mevzuat.gov.tr`, `resmigazete.gov.tr`) refused
   this environment today, so it currently rests on secondary commentary.
9. **The duty line — build it, or publish only the rate table?** See the counter-argument
   above. A per-bottle duty figure is exact and useful and is also a number no issuer ever
   published. Your call, and it is the second half of Q4.
10. **Does `restaurants.currency` actually say `TRY` and `GBP` for these three houses?** If it
   says `USD` — the column default — then fixing the writer fixes nothing, and the real repair
   is a data correction on three tenant rows. **A read, not a write.** Shall an agent measure
   it?
11. **Türkiye and the UK are food-rich and drink-poor.** HKS (daily, national, TL/kg, live
   today) and Defra (fortnightly, CSV, OGL, GBP/kg) are both fully verified **produce**
   sources — the two cleanest fetches in this entire registry — while both markets are empty
   for drink. Is the food side worth building for these three houses first, ahead of the drink
   side it was commissioned for?
12. **AHDB is measured as unusable and worth confirming you agree.** Its terms forbid
    third-party publication and limit use to internal business purposes; putting an AHDB number
    on a tenant's screen is publication. Do you want a written-permission request opened, or is
    AHDB simply out?

---

---

## Türkiye and the United Kingdom, re-measured 2026-09-05

The founder's call of 2026-09-05 — **"their own source class, researched per market"** — sent
every 2026-09-04 candidate back through a fetch, with the question sharpened: *which of these
can actually produce a row?* One can. The full argument, the rejected alternatives and the new
founder questions are in
[ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)
§"Non-US markets: Türkiye and the United Kingdom (2026-09-05)". Every fetch below is logged with
its status and first 200 bytes in `p4-scratch/p4ab-fetch-log.md`.

**The estate's three non-US houses, read (never written) 2026-09-05:** Chez Community
(Fethiye, `state_province` `Muğla`, `country` `Türkiye`); The Old House Pub (Antalya,
`state_province` **NULL**, `country` `Türkiye`); ADMIN 1 (London, `England` / `United Kingdom`).
**And `restaurants.currency` is `USD` on all fourteen rows** — which answers Q10: fixing the
class-A writer alone fixes nothing.

### Türkiye — none found

| Source | URL | Class | Verified 2026-09-05 | Registry |
|---|---|---|---|---|
| **HKS hal bulletin** | `https://www.hal.gov.tr/Sayfalar/FiyatDetaylari.aspx` | E | **HTTP 200, 64,583 B.** Live and dated: *"Bülten Tarihi : 5.09.2026 (4.09.2026 Tarihli Veriler Kullanılmıştır.)"*; row read verbatim `ACUR / ACUR / Geleneksel(Konvansiyonel) / 23,78 / 69216 / Kg`; no currency on the row. **No `.ashx`, `/api/` or `.json` endpoint in the served HTML**; the export is a postback control, later pages need `__VIEWSTATE` | `silent: no_machine_endpoint` |
| **İBB open data (hal prices)** | `https://data.ibb.gov.tr/dataset/hal-urunleri-ve-fiyatlari-web-servisi` | E | **HTTP 403** (nginx) | — the machine alternative to HKS, closed |
| **İBB hal-price Swagger** | `https://halfiyatlaripublicdata.ibb.gov.tr/swagger/docs/v1` | E | **Transport error: empty reply from server** | — |
| **GİB ÖTV (III)(A)** | `https://www.gib.gov.tr/yardim-ve-kaynaklar/yararli-bilgiler/otv-oranlari` | E | `robots.txt` **200**, `User-agent: * / Allow: /`. Landing page **200, 39,777 B** but a Next.js shell with **no PDF link and no `cdn.gib.gov.tr` reference** in its served HTML — the schedule was NOT re-read today. A tax, and its unit is not stated on the face of the table | `silent: not_a_price` |
| **TÜİK veri portalı** | `https://veriportali.tuik.gov.tr/` | E | `robots.txt` **200**, `Allow: /`, and it names `anthropic-ai` / `ClaudeBot` / `ClaudeUser` / `Claude-SearchBot` in an explicit allow group — **the only source in this register that permits us by name**. Its sitemap advertises `/sdmx-web-service-documentation` and `/bulk-download`; both render *"JavaScript Required"* (3,685 B) and the entry bundle names no API base | not registered — unverified (Q22) |
| **Kavaklıdere** | `https://www.kavaklidere.com/robots.txt` | C | **200.** `*` allowed except `/wp-admin/`; **GPTBot, CCBot, Google-Extended and AdsBot blocked by name** | not a price source |
| **Doluca** | `https://www.doluca.com/robots.txt` | C | **200.** `Disallow: /shop/`, `Disallow: /video/` — **the shop is closed to a polite fetcher** | not a price source |
| **Mey\|Diageo Türkiye** | `https://www.diageoturkiye.com/robots.txt` | C | **200.** `Allow: /` but **`Disallow: /markalarimiz/katalog`** — the catalogue is explicitly disallowed | not a price source |
| **Migros** | `https://www.migros.com.tr/robots.txt` | D | **200, 603 B.** `Disallow: /arama` and `/*espv` only; a sitemap enumeration would be permitted. Moot: online alcohol sale is unlawful in Türkiye | not registered |
| **CarrefourSA** | `https://www.carrefoursa.com/robots.txt` | D | **HTTP 403** — the crawl rules themselves cannot be read, so nothing may be fetched | not registered |
| **mevzuat.gov.tr** | `https://www.mevzuat.gov.tr/robots.txt` | — | **Transport error: timed out after 45s** (second consecutive day) | primary law still unverified (Q8) |
| **resmigazete.gov.tr** | `https://www.resmigazete.gov.tr/robots.txt` | — | Redirected to `http://resmigazete.gov.tr/` and returned **HTTP 400** with an empty error body | primary law still unverified (Q8) |

### United Kingdom — one found

| Source | URL | Class | Verified 2026-09-05 | Registry |
|---|---|---|---|---|
| **Defra wholesale fruit and vegetable prices** | series `https://www.gov.uk/government/statistical-data-sets/wholesale-fruit-and-vegetable-prices-weekly-average`; edition `.../media/6a918dd7f5b35599aec18f5b/fruitvegprices-260901.csv` | **E — the only entry with a parser** | Series page **200**; CSV **200, 861,585 B**, sha256 `ab56ded3a4bc3f65fd49e438fc6b43d7a0a9f22f2595afd1c2049941cc258c3d`. **17,594 rows**, headers exactly `category,item,variety,date,price,unit`; newest date **31/08/2026**, 55 rows; units kg 14,612 / head 2,108 / stem 428 / twin 397 / unit 49; zero blank prices, zero blank units; **one published price of 0** (`cut_flowers,gladioli,all_varieties,05/07/2024,0,stem`). Page states issuer *Department for Environment, Food & Rural Affairs*, cadence *fortnightly*, extent *"in England and Wales"* (Birmingham, Bristol, Manchester and a London market), licence **OGL v3.0** | **`parse-defra.ts`, `GB-EAW`, GBP. SHOWN as its own labelled box on the founder's Q24 call of 2026-09-05 (*"show it, labelled as produce, in its own box"*). Arming the fetch is one thing only: setting `PRICE_INDEX_FETCH_ENABLED` to "true" or "1" on the deployment — not a code change, not a product toggle** |
| **ONS RPI average prices — drink** | `.../timeseries/{kef4,czms,czmt,czmr}/mm23/data` | D | **All four HTTP 200**, unit `Pence`, a stated measure and a monthly date. **Every last observation is 2025 JAN** (517 / 483 / 380 / 390) while `releaseDate` says **2026-08-18** and `nextRelease` **16 September 2026**. `czmj`-equivalent food series (`CZNJ` tomatoes) stops the same month, so the family is dead, not only drink | `silent: discontinued` — **the trap this pass exists to record** |
| **ONS CPI alcohol index** | `.../timeseries/d7bv/mm23/data` | E | **HTTP 200**, live (2026 JUL = 159.9, `releaseDate` 2026-08-18). Its own metadata declares `unit: "Index, base year = 100"` — **an index number, not a price**, and `price_index_postings` requires a price with a currency and a unit | not registered (Q23) |
| **HMRC alcohol duty rates** | `https://www.gov.uk/guidance/alcohol-duty-rates` + `https://www.gov.uk/api/content/guidance/alcohol-duty-rates` | E | Page **200, 90,801 B**; Content API **200** with `public_updated_at` `2026-02-01T00:15:01Z` and organisation *"HM Revenue & Customs"* — issuer and date machine-readable. Rates per litre of pure alcohol (wine/spirits 3.5-8.4% GBP 26.61, 8.5-22% GBP 30.62, >22% GBP 33.99; beer 3.5-8.4% GBP 22.58). **A rate, not a price** | `silent: not_a_price` |
| **data.gov.uk catalogue** | `https://ckan.publishing.service.gov.uk/api/3/action/package_search` | — | **200.** `q=alcohol price` -> **2 results**, both *non-alcoholic* beverage CPI (Greater London Authority). `q=wine OR spirits OR beer price` -> **1 result**, HMRC's *Alcohol Duties Factsheet*. **The UK publishes no open dataset of alcohol prices** | the proving sentence for "none found" on the drink side |
| **Matthew Clark Bibendum (MCB)** | `https://www.mcbdrinks.co.uk/` | C | `robots.txt` **200** — `*` allowed except `/umbraco/`. Wine listing `/products/wine` **200, 71,184 B** with **zero `£` figures** and a "Customer Login". The largest UK on-trade drinks wholesaler permits the crawl and has nothing priced to read | class C, per-account |
| **LWC Drinks** | `https://www.lwc-drinks.co.uk/robots.txt` | C | **200.** `Crawl-delay: 10`, `Disallow: /cdn-cgi/` only | class C, per-account |
| **Bibendum** | `https://www.bibendum-wine.co.uk/robots.txt` | C | **200**; the site redirects into MCB above | class C |
| **Enotria&Coe** | `https://www.enotria.co.uk/robots.txt` | C | **HTTP 522** (origin unreachable) | unverified |
| **Majestic** | `https://www.majestic.co.uk/robots.txt` | D | **HTTP 403** — a Cloudflare interstitial *in place of the crawl rules* | must stay unfetched |
| **Tesco** | `https://www.tesco.com/robots.txt` | D | **HTTP 403** "Access Denied" | must stay unfetched |
| **Waitrose** | `https://www.waitrose.com/robots.txt` | D | **Transport error**, HTTP/2 INTERNAL_ERROR | must stay unfetched |
| **WSTA Data Hub** | `https://wsta.co.uk/data-hub/` | — | **200.** Re-read verbatim: *"All data not to be shared outside of WSTA member organisation."* Volume and value, not price | not a price source |
| **Scotland minimum unit pricing** | `https://www.gov.scot/policies/alcohol-and-drugs/minimum-unit-pricing/` | — | **HTTP 202 with a zero-byte body** (a bot challenge). Also a legal floor rather than a price, and Scotland-only — the estate's one UK house is in London | not registered |

**Three UK retailers, three consecutive refusals, two days running: until a robots.txt is
actually read, no UK retail sweep may be written.**

### The ISO code listings this build hard-codes, fetched rather than remembered

| Listing | URL | Verified 2026-09-05 |
|---|---|---|
| ISO 3166-2:TR | `https://en.wikipedia.org/w/api.php?action=parse&page=ISO_3166-2:TR&prop=wikitext&format=json&formatversion=2` | **200, 8,655 B.** 81 province codes parsed, no name collision after diacritic folding. `Antalya`->`TR-07`, `Muğla`->`TR-48`, `İstanbul`->`TR-34`, `Adana`->`TR-01`, `Düzce`->`TR-81` |
| ISO 3166-2:GB | same, `page=ISO_3166-2:GB` | **200, 33,548 B.** `GB-ENG`/`GB-SCT`/`GB-WLS` (country), `GB-NIR` (province); and in remark part 2, *"included for completeness"*: **`GB-EAW`** England and Wales, `GB-GBN` Great Britain, **`GB-UKM`** United Kingdom |

### Fixture recorded 2026-09-05 (real bytes, chosen to exercise the refusals, values untouched)

| Fixture (module `__fixtures__/`) | Source | Fetched | Rows | Bytes | Format |
|---|---|---|---|---|---|
| `defra-wholesale-fruit-veg-2026-09-01.sample.csv` | Defra wholesale fruit and vegetable prices, edition `fruitvegprices-260901.csv` (parent sha256 `ab56ded3…c258c3d`) | 2026-09-05 | 59 of 17,594 — the 55 rows of 31/08/2026, 3 rows of the 17/08/2026 edition (to exercise `row_older_than_file`), and the file's one zero-price row (to exercise `no_price`) | 2,859 | CSV |

## Michigan and Illinois, measured 2026-09-05 (ADR 0117, "Michigan and Illinois: the best honest line")

Every fetch below carried the identifying User-Agent, honoured `robots.txt` and was recorded with
its status and body in `p4ac-fetch-log.md`. **No browser User-Agent was sent and no block was
routed around.**

### Michigan distributors and republishers

| Source | URL | Public prices? | Verified | Measured 2026-09-05 |
|---|---|---|---|---|
| **Imperial Beverage** | `https://imperialbeverage.com/` | **no** | yes | `robots.txt` 200 with an empty `Disallow:` (everything allowed). Home page 200; **4,105 visible characters and no dollar amount anywhere**; the doors are "Staff Login / Supplier Login / Account Login". Class C |
| **Great Lakes Wine & Spirits** | `https://www.greatlakeswineandspirits.com/` | **no** | partial | `robots.txt` 404; the home page redirects and renders 20 visible characters (a JavaScript shell). No public list. Class C |
| **RNDC (Michigan)** | `https://www.rndc-usa.com/` | **no** | partial | `robots.txt` 200 (WordPress). A corporate site; buying is per account. Class C |
| **Liquorli.st** | `https://www.liquorli.st/` | yes, but the wrong number and the wrong issuer | yes | `robots.txt` 200, `Allow: /`, last modified 2026-09-01, so it is live. It republishes Michigan's spirits prices and disqualifies itself in its own words twice: it shows *"Michigan's **minimum retail shelf price**"* (retail, not the licensee price a restaurant pays) and *"is not affiliated with or endorsed by the Michigan Liquor Control Commission"*. A third party's scrape fails ADR 0117's issuer test, exactly as `ctpricefile.com` does for Connecticut. **Not pursued** |

### Michigan beer and wine: posted, and not published

The brief assumed Michigan posts no wholesale beer or wine prices. It does — and the distinction
between *filing* and *publishing* is the whole answer.

> **Mich. Admin. Code R. 436.1726** (wine): "A manufacturer or wholesaler shall **file with the
> commission in Lansing**, before January 1, April 1, July 1, and October 1 of each year, a
> schedule of the net cash prices to retail licensees for all wine by kind, type, size, and
> brand. (2) The prices filed shall not be changed during a quarterly period, unless approved by
> a written order of the commission."

> **Mich. Admin. Code R. 436.1625** (beer): "A manufacturer or wholesaler shall **file with the
> commission in Lansing** a schedule of net cash prices to the retail licensee for all brands of
> case and keg beer for its market area… The price reduction shall be filed before its effective
> date and shall continue for at least 180 days after the effective date."

Neither rule requires publication. The verb is "file with the commission" in both. So the
schedules exist, quarterly for wine and event-driven for beer, the MLCC holds them as public
records, and **only a FOIA request reaches them.** The honest line for a Michigan wine house is
therefore *not* "Michigan posts no wine prices"; it is that the schedules are filed rather than
published. Filed as founder question Q19 in ADR 0117.

> **Corrected 2026-09-05, later the same day (ADR 0126).** "Those are public records" is only half
> true and the missing half changes what a request is worth. **MCL 436.1609a** — read verbatim on
> `codes.findlaw.com` (HTTP 200; `legislature.mi.gov` answers 403 to `curl` and fails TLS
> verification to the harness fetcher, and every `michigan.gov` path answers 403 including its own
> `robots.txt`) — provides that "a net cash price filed under subsection (1) and a price change
> filed under subsection (2) are exempt from disclosure under section 13 of the freedom of
> information act, 1976 PA 442, MCL 15.243, **until 1 year after** the net cash price or price
> change is filed", with the same exemption stated for the wine filings. So a granted request can
> never return a schedule less than twelve months old, and a standing quarterly request yields a
> rolling twelve-month-lagged series rather than a posted list. **Two smaller corrections from the
> rules themselves**, both read verbatim on `law.cornell.edu`, HTTP 200: the quarterly cadence is
> **wine's** — R 436.1726(1), filed "before January 1, April 1, July 1, and October 1 of each year"
> — and **beer has no recurring filing date at all** (R 436.1625 requires a schedule and requires a
> reduction to be filed before its effective date and held "at least 180 days"). The request text
> is drafted for the founder to send at
> [`MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md`](MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md); **nothing has
> been sent**, and the register records the request as `not_yet_filed`, never as `requested`. The
> source entry is `michigan-lcc-filed-beer-wine-schedules` with `intake: "foia"`, no `parse` (the
> Commission's format for these schedules is unknown — nobody has seen one) and `maxAgeDays: 480`,
> which is the embargo's arithmetic and **not** a freshness allowance.

### Illinois

| Source | URL | Format | Terms | Verified | Measured 2026-09-05 |
|---|---|---|---|---|---|
| **ILCC — statutes and rules** | `https://ilcc.illinois.gov/divisions/legal/ilcc-statutes-and-rules.html` | HTML | no `robots.txt` (404, unrestricted per RFC 9309) | **yes** | 200, 73,622 bytes. Links to the Liquor Control Act and two administrative codes and **nothing else** — no price file, no posting page, no lookup |
| **235 ILCS 5/6-19** | `https://www.ilga.gov/documents/legislation/ilcs/documents/023500050K6-19.htm` | HTML | `ilga.gov` robots: `Crawl-delay: 10`, only `/account /admin /search /api` disallowed | **yes** | In full: *"Sec. 6-19. (Repealed). (Source: P.A. 82-783. Repealed by P.A. 90-432, eff. 1-1-98.)"* |
| **11 Ill. Adm. Code 100** | `https://ilga.gov/agencies/JCAR/EntirePart?titlepart=01100100` | HTML | as above | **yes** | 216,637 bytes / 2,148 text lines read whole. **53 distinct section headings, none containing "price", "posting" or "schedule"**; all 16 body occurrences of "price" are trade-practice rules |
| **235 ILCS 5 Article VI index** | `https://law.onecle.com/illinois/235ilcs5/indexVI.html` | HTML | no `robots.txt` (404) | **yes** | The only "schedule of the prices" in the whole article is 6-28, *happy hours* — a retailer's own drink list at its own premises |
| **Illinois Liquor Gallonage Tax** | `https://tax.illinois.gov/research/taxrates/excise.html` | HTML | `robots.txt` 200, only draft forms disallowed | **yes** | Issuer: Illinois Department of Revenue. **For reporting periods July 2026 or after**: $0.231/gal beer or cider 0.5-7% ABV; $1.39/gal other liquor at or below 14%; $1.39/gal above 14% up to 20%; **$8.55/gal above 20%**. A tax, not a price — class E, and the derived-per-bottle fork is already open as Q9 |
| **Cook County alcoholic beverages tax** | `https://www.cookcountyil.gov/service/liquor-tax` | HTML | `robots.txt` 200 | partial | 200. The page names the ordinance (Chapter 74, Article IX, amended 2023-12-14) and the registered-wholesaler list, but **carries no rate**; the rate page was not located today |
| **City of Chicago liquor tax** | `https://www.chicago.gov/` | — | — | **no** | `robots.txt` **403 `AkamaiGHost`, reference `#18.…`** — the same edge-deny shape as michigan.gov. The city's third-party code publisher (`codelibrary.amlegal.com`) publishes `Disallow: /` for `ClaudeBot` and a `Content-Signal: ai-train=no` reservation and **was not fetched**. Chicago's rate is **unverified** |
| **Binny's Beverage Depot** | `https://www.binnys.com/` | HTML | `robots.txt` 200: product pages allowed, `/search` disallowed, and it **advertises `Sitemap: /Sitemap.xml`** — a more permissive robots policy than Total Wine's | **no** | Both `/Sitemap.xml` and `/` return **HTTP 403 with a Cloudflare "Attention Required!" challenge** (4,574 bytes, identical). The robots policy permits enumeration; the server refuses this fetcher. Not a fetchable class-D reference |
| **Breakthru Beverage (IL)** | `https://www.breakthrubev.com/` | HTML | `robots.txt` 200, `User-Agent: * / Allow: /` | yes | 200, 107,889 bytes; **3,000 visible characters with no dollar amount at all**. The buying paths are "Partner Portal", "Customers Order Here" and "Access Breakthru Now". The absence of prices is the vendor's choice, not a block. Class C |

**The finding.** Illinois is the mirror image of Michigan. Michigan publishes the right number
and refuses the reader; Illinois welcomes the reader and publishes no number. Michigan's answer
is therefore a path (a person carries the file); Illinois' answer is a sentence naming a repealed
statute. Neither answer works for the other state.

**Amended 2026-09-05, later the same day (ADR 0126).** The Illinois sentence used to end by
pointing the house at "a connection this house declares". That door was then tried, and it is
locked: Breakthru's buyer portal publishes `Disallow: /` for every path but its login, and both
Breakthru's and Southern Glazer's terms of use forbid automated access — Southern Glazer's
separately forbidding you from giving "any other person" access with your credentials, which is
what declaring a portal login would be. See §"Class C re-measured 2026-09-05" above. The Illinois
sentence now ends where the answer actually is: **the house's own invoices are the licensee price
list**, and this house already records them.

## The register these feed, built 2026-09-04 (ADR 0117 steps 2–3)

Classes B, D and E now have a home that is not `vendor_price_observations`:
`price_index_postings` (`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql`),
keyed by **state, not restaurant**, RLS on and anon/authenticated revoked, unique on
`(source_ref, content_hash)`. The parsers live in `apps/api-gateway/src/price-index/`
(one truth per source, shared by the scheduled fetch and the read endpoint); the Python
`fetch_price_sightings.py` stays as the independent full-file proof for Iowa/Oregon.

- **California** parser is **live** — fetched today via the app's own anonymous JWT path.
- **Iowa/Oregon** parsers are **ported class-D shelf lines** — the "control-state shelf
  price as a labelled index line, state-scoped" the founder asked for; no tenant sits in
  either state yet, but `GET /price-index/US-IA` would serve one the moment it did.
- **Michigan** is **withheld from the FETCHER and now has a parser** — superseding the line
  that stood here, *"writes no parser, because no honest sample exists"*. **Corrected
  2026-09-05:** a real edition of the book was obtained and measured (12,530 product rows,
  zero defects; `price-index/__fixtures__/MICHIGAN-PROVENANCE.md`), so an honest sample does
  exist and `parse-michigan.ts` is written against it. What does not exist is a fetch path:
  `michigan.gov` 403s from an Akamai Kona Site Defender edge and `data.michigan.gov` publishes
  `Disallow: /`. The registry entry therefore keeps `withheld` and **no `parse`** — so the
  scheduled sweep can never try michigan.gov — and gains `intake: "upload"`. The live path is
  `POST /price-index/upload`: a manager's own download, dry run by default, `commit` gated on
  `PRICE_INDEX_UPLOAD_ENABLED`, the staleness gate before every write, and the person, the file
  name and the file's sha256 on every row. Its cadence was corrected in the same pass from
  `monthly`/62 days to **`quarterly`/105 days** — 62 would have refused a current book from day
  63 of its own 91-day cycle.

  **Since 2026-09-05 (ADR 0128) a carried book is not the index line until somebody lets it in.**
  The rows are written either way, but `price_index_postings.admitted_at` decides whether they
  are the market, and one exported predicate (`MARKET_VISIBILITY`) applies it to every read. A
  ROUTINE book — a later edition whose diff against the last admitted one sits inside every band
  in `upload-tier.ts` — is stamped admitted at write time and the other owners and managers in
  the jurisdiction are told. **Every first book of a source is held**, because there is nothing to
  compare it with, as is any book outside a band or any book whose comparison could not be made.
  The pool that may admit it is the JURISDICTION, not the house: this table has no
  `restaurant_id`, so a carried book is every house in that state's number. The bands are reasoned
  and **UNMEASURED** — this repository holds one edition of one state book — and every upload
  records its real diff so the second edition can replace the reasoning with evidence.

The scheduled fetch defaults **OFF** behind `PRICE_INDEX_FETCH_ENABLED`;
`GET /price-index/status` says per source when it last fetched, how many rows, and why it
is silent. Endpoint: `GET /price-index/:state?product=`.

### Fixtures recorded today (real bytes, chosen to exercise the refusals, values untouched)

| Fixture (module `__fixtures__/`) | Source | Fetched (UTC) | Rows | Bytes | Format |
|---|---|---|---|---|---|
| `california-abc-beer-2026-09-04.sample.json` | CA ABC beer price posting (AppSync `PricePostings`, Santa Clara county) | 2026-09-04 | 13 of 50+ (Active/Inactive/Old, Retailers/Wholesalers/Manufacturers, ML/OZ/Gallon/Liter, a container charge, a duplicate) | 10,098 | JSON array |
| `iowa-liquor-products-2026-09-01.sample.ndjson` | Iowa Liquor Products (dataset 1029) | 2026-09-04 | 24 of 13,762 | 10,122 | NDJSON |
| `oregon-olcc-pricing-2026-09-01.sample.json` | Oregon OLCC Monthly Pricing (`vmf2-f83h`) | 2026-09-04 | 12 of 3,856 | 5,874 | JSON array |
| `michigan-lcc-price-book-2025-08-03.sample.json` | MLCC spirits price book, 2025-08-03 edition (`8-3-25-PRICE-BOOK-EXCEL.xlsx`, 804,270 bytes, sha256 `ff592f82db6c657caad03fb889dbfe2f0e234c8e5b82354b5687cd19f248c438`), obtained from an Internet Archive capture of 2025-09-08 because the origin 403s this fetcher | 2026-09-05 | 24 of 12,795 — the 3-line header, a blank spacer, a category heading and a `(CONTINUED)` one, and 18 product rows spanning every published size (50-1750 ml) and pack (1-144), both `MI`-distiller rows, all three `NEW/CHNG` notations, and the two rows at the extremes of the licensee/base band (0.9194, 0.9773) | 3,794 | JSON (rows of 12 cells) |

**One caveat this table cannot hold, so it is stated here.** The Michigan fixture is a *shape*
fixture and nothing more. Its edition is thirteen months old against a 91-day cadence, so the
staleness gate refuses it — which is exactly what `parse-michigan.spec.ts` and
`price-index-upload.spec.ts` assert. **No price in it may ever be shown to a house.** Full
provenance, the reason the archive was used, and the full-file measurement are in
`apps/api-gateway/src/price-index/__fixtures__/MICHIGAN-PROVENANCE.md`. The other three fixtures
above were fetched from their issuers directly.
