---
type: reference
title: Price source registry
status: live
updated: 2026-09-04
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
| **Vendor website scrape** | `vendor-page-extractor.service.ts` → tier 4 `website_scrape` | HTML → model extraction | on demand / `sweepCatalogue` | robots.txt checked (`:87`), fails closed on a disallow | 2s between hosts (`:377`), identifying UA (`:25`) | yes — `source_url`, `observed_at`, `http_status`, `content_hash` | yes (code) | **Built, polite, never run.** Production holds **23 active vendors with a website** (`vendor_catalogue`, 25 total) and **0 observations**. Founder question Q1 |

---

## Class B — posted wholesale lists (a price a state requires someone to publish)

| Source | URL | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|
| **New York SLA price postings** | `https://www.nyslapricepostings.com/public/price-lookup` (named by `https://sla.ny.gov/price-posting`) | web lookup | monthly; wholesale schedules due the 25th, two months ahead | public by statute | unstated | yes — the wholesaler and the posting month | **partial** | The SLA's own page confirms *"price schedules are publicly viewable"* and names the lookup URL. **The lookup itself returned an empty body to WebFetch** (twice, two paths) — a JS app, most likely. Prices, wholesaler-to-retailer, for the largest wine market in the US. **The single best class-B candidate found, and unverified** |
| **California ABC beer price posting** | `https://priceposting.abc.ca.gov/publicPricePosts` (described at `https://www.abc.ca.gov/licensing/beer-price-posting/`) | web search, per county | continuous; new schedules effective on filing, amendments after 10 days | public; mandatory online filing since 2023-10-15 | unstated | yes — the filing licensee and the effective date | **no** | The ABC page confirms who must file (types 01/23/75, 09/10, 17) and that filing is per county, and mentions **no export**. The public search **failed TLS chain verification** from this environment. **Beer only** — but 3 of 14 tenants are in California |
| **Michigan LCC spirits price book** | `https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info` | PDF + Excel "New Item Price List" + a searchable book | monthly | state publication | unstated | yes — the book's effective date | **no** | **403 to this environment's fetcher on both the info page and a direct PDF.** Search results confirm the book carries a **Licensee Price** (what a licensee pays) distinct from Base Price. **3 of 14 tenants are in Michigan — the best jurisdictional match in the estate, and unread** |
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

---

## Class D — retail references (never beside a vendor quote)

| Source | URL | Format | Terms | Rate limit | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|
| **Iowa Liquor Products** | `https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json` (303 → signed GCS) | **NDJSON**, no key | **CC BY 4.0** per `catalog.data.gov/dataset/iowa-liquor-products`; **attribution required**. `data.iowa.gov` itself 403'd, so the licence is cited from the federal mirror | none stated; one file per month is enough | **yes** | **13,762 rows, `report_as_of = 2026-09-01` on every one.** 100% coverage of price, `bottle_volume_ml`, `pack`, `upc`. 392 suppliers, 11,451 item numbers, 48 categories, **all spirits — no wine, no beer**. Median `state_bottle_retail / state_bottle_cost` = **exactly 1.50** (Iowa's markup). Our parser: **11,425 sightings, 2,337 refused** (2,308 duplicate item numbers, **29 rows where bottle cost × pack disagrees with the published case cost**), plus **11 rows publishing `bottle_volume_ml = 0`**. Fixture + parser: `scripts/fetch_price_sightings.py` |
| **Oregon OLCC Monthly Pricing** | `https://data.oregon.gov/resource/vmf2-f83h.json` (Socrata; CSV/JSON/XML exports) | JSON array, no key | **No licence declared.** Metadata declares only `attribution: "Oregon Liquor & Cannabis Commission"` — unstated terms, not permissive terms | `robots.txt`: `Crawl-delay: 1`, `/resource/` not disallowed. Socrata: unauthenticated requests share a per-IP pool and get 429; a free app token gives 1,000 req/rolling hour | **yes** | **263,338 rows across all months; 3,856 for `asofdate = 2026-09-01`** (3,849 Aug, 3,839 Jul, 3,799 Jun). 21 columns including `asofdate`, `size`, `priceperunit`, `unitspercase`, `pricepercase`, `pricechange`, `priceperoz`. Spirits only. Our parser: **12/12 fixture rows admitted, 0 refused** — the cleanest file measured |
| **Utah DABS product lists** | `https://abs.utah.gov/licenses-permits/off-premise-products/`, `.../shop-products/interactive-product-list/` | embedded table with CSV/Excel/Sheets export; monthly price books as PDF | not stated on the page | unstated | partial | Page fetched. The export is a **UI affordance** (*"hover over the Product Name column and click the three dots"*), not a URL — there is no documented machine endpoint |
| **Wine-Searcher trade API** | `https://www.wine-searcher.com/trade/api`, `.../trade/ws-api` | REST, XML or JSON | commercial licence; trial key on application | unstated | **no** | The pricing page returned **403** with `Retry-After: 0`. **Cost unmeasured.** The only broad wine-price source found; founder question Q5 |
| **Total Wine** | `https://www.totalwine.com/` | HTML | site terms not read | `robots.txt` fetched: product pages are allowed, but **`/search/` is `Disallow`** | partial | Which means there is **no permitted way to enumerate the catalogue** — you may read a product page you already know the URL of, and may not go looking. Retail price regardless |
| **Vivino** | `https://www.vivino.com/` | HTML | — | — | **no** | `robots.txt` could not be fetched: *"Unable to verify if domain www.vivino.com is safe to fetch"* from this environment. Named in `EXTERNAL_CONNECTIONS.md:153` as a host the code scrapes without the SSRF guard |
| **LCBO (Ontario)** | — | — | — | — | **no** | No official open API found. The best-known community mirror, `LCBOstats`, **sunset 2025-06-03** with data ending May 2025. AGCO publishes an open-data inventory (April 2026) but not prices |

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
- **Illinois** — 3 tenants, and no price-posting requirement to publish against.

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
