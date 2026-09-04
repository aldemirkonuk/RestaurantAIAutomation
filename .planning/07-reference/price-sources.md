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
| **Vendor website scrape** | `vendor-page-extractor.service.ts` -> tier 4 `website_scrape`, judged by `vendor-site-sighting.ts` | HTML -> model extraction | **daily cron `20 4 * * *`, OFF by default** (`VENDOR_SITE_SWEEP_ENABLED`); `sweepCatalogue` still available by hand | robots.txt checked, fails closed on a disallow; **`Crawl-delay` now parsed** (`parseCrawlDelay`) and honoured as the floor | **10s per host** (`DEFAULT_HOST_INTERVAL_SECONDS`), raised to the host's own Crawl-delay when larger, never below 2s; identifying UA | yes - `source_url`, `content_hash`, `http_status`, and **the page's own date when it states one**, else the fetch time carrying `raw.undated = true` | yes (code + a live dry run) | **BUILT and RUN once, in dry run, 2026-09-04** (founder's Q1 answer: *"Run it, labelled tier 4, never beside a quote"*). `www.wine.com/robots.txt` fetched with the identifying UA: **6,038 bytes, no `Crawl-delay` for any agent**, `/search` **disallowed** (no permitted way to enumerate a catalogue), `/` and `/product/*` allowed. The allowed homepage then returned **HTTP 403** with a DataDome captcha body (768 bytes). `www.klwines.com` returned **403 to the robots.txt request itself**, behind a Cloudflare challenge. **Two of two real merchant sites refused this environment at the page** - recorded as unverified, never as unavailable. Production still holds 23 active `vendor_catalogue` vendors with a website; the sweep now reads `providers` per restaurant instead, so a sighting is never written tenant-less. Refusals are counted by reason and reported at `GET /vendor-intel/site-sweep/status` |

---

## Class B — posted wholesale lists (a price a state requires someone to publish)

| Source | URL | Format | Cadence | Terms | Rate limit | Issuer + date? | Verified | Measured 2026-09-04 |
|---|---|---|---|---|---|---|---|---|
| **New York SLA price postings** | `https://www.nyslapricepostings.com/public/price-lookup` (named by `https://sla.ny.gov/price-posting`) | web lookup | monthly; wholesale schedules due the 25th, two months ahead | public by statute | unstated | yes — the wholesaler and the posting month | **partial** | The SLA's own page confirms *"price schedules are publicly viewable"* and names the lookup URL. **The lookup itself returned an empty body to WebFetch** (twice, two paths) — a JS app, most likely. Prices, wholesaler-to-retailer, for the largest wine market in the US. **The single best class-B candidate found, and unverified** |
| **California ABC beer price posting** | `https://priceposting.abc.ca.gov/publicPricePosts`; data via `https://s7fcylvn8j.execute-api.us-west-2.amazonaws.com/prod/public/graphql` (AppSync) | SPA → GraphQL | continuous; new schedules effective on filing, amendments after 10 days | public; mandatory online filing since 2023-10-15 | app signs a 20s JWT per query; one request per county per day, identifying UA | yes — the filing licensee and the effective date (`effectiveDate`, epoch ms) | **yes** | **LIVE and parsed 2026-09-04.** The public search is a SPA; its data comes from an AppSync `public/graphql` endpoint whose queries are authorised by a JWT the app **signs in the browser** with a secret shipped in its own bundle (`REACT_APP_JWT_SECRET`). Reproducing that is the anonymous path the public uses — no login, no scrape. Fetched Santa Clara county (where the CA houses sit): `PricePostings` returns `manufacturer/product/tradeName/status/package/productSize{size,unit,containerType}/county/pricesTo/price/pricePromotion/containerCharge/effectiveDate`. Statuses `Active`/`Inactive`/`Old`; `pricesTo` `Retailers`/`Wholesalers`/`Manufacturers`; units ML/OZ/Gallon/Liter. **Parser: `apps/api-gateway/src/price-index/parse-california.ts`**; the earlier "TLS chain failure" was this environment lacking that host's CA cert — Node in the gateway has it. Fixture: 13 real rows, `california-abc-beer-2026-09-04.sample.json`. **Beer only** — but 3 of 14 tenants are in California |
| **Michigan LCC spirits price book** | `https://www.michigan.gov/lara/bureau-list/lcc/spirits-price-book-info` | PDF + Excel "New Item Price List" + a searchable book | monthly | state publication | unstated | yes — the book's effective date | **no** | **403 to this environment's fetcher on both the info page and a direct PDF** (Akamai edge; `www.michigan.gov/robots.txt` is itself 403). Search results confirm the book carries a **Licensee Price** (what a licensee pays) distinct from Base Price. **3 of 14 tenants are in Michigan — the best jurisdictional match in the estate, and unread.** **WITHHELD in the registry** (`price-index.registry.ts`): no parser is written, because there is no honest sample. A human Excel download is the path |
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
| **Iowa Liquor Products** | `https://idh-be.iowa.gov/api/v1/datasets/1029/rows.json` (303 → signed GCS) | **NDJSON**, no key | **CC BY 4.0** per `catalog.data.gov/dataset/iowa-liquor-products`; **attribution required**. `data.iowa.gov` itself 403'd, so the licence is cited from the federal mirror | none stated; one file per month is enough | **yes** | **13,762 rows, `report_as_of = 2026-09-01` on every one.** 100% coverage of price, `bottle_volume_ml`, `pack`, `upc`. 392 suppliers, 11,451 item numbers, 48 categories, **all spirits — no wine, no beer**. Median `state_bottle_retail / state_bottle_cost` = **exactly 1.50** (Iowa's markup). Our parser: **11,425 sightings, 2,337 refused** (2,308 duplicate item numbers, **29 rows where bottle cost × pack disagrees with the published case cost**), plus **11 rows publishing `bottle_volume_ml = 0`**. Fixture + proof: `scripts/fetch_price_sightings.py`; **ported to the gateway register 2026-09-04** as class D — `apps/api-gateway/src/price-index/parse-iowa.ts`, tested against the same fixture (20/24 fixture rows admitted, the 3+1 defects counted) so the two implementations cannot drift |
| **Oregon OLCC Monthly Pricing** | `https://data.oregon.gov/resource/vmf2-f83h.json` (Socrata; CSV/JSON/XML exports) | JSON array, no key | **No licence declared.** Metadata declares only `attribution: "Oregon Liquor & Cannabis Commission"` — unstated terms, not permissive terms | `robots.txt`: `Crawl-delay: 1`, `/resource/` not disallowed. Socrata: unauthenticated requests share a per-IP pool and get 429; a free app token gives 1,000 req/rolling hour | **yes** | **263,338 rows across all months; 3,856 for `asofdate = 2026-09-01`** (3,849 Aug, 3,839 Jul, 3,799 Jun). 21 columns including `asofdate`, `size`, `priceperunit`, `unitspercase`, `pricepercase`, `pricechange`, `priceperoz`. Spirits only. Our parser: **12/12 fixture rows admitted, 0 refused** — the cleanest file measured. **Ported to the gateway register 2026-09-04** as class D — `apps/api-gateway/src/price-index/parse-oregon.ts`, same fixture, `1.75 L → 1750 ml` |
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
- **Michigan** is **withheld** — `price-index.registry.ts` records it unverified with the
  403 evidence and writes **no parser**, because no honest sample exists.

The scheduled fetch defaults **OFF** behind `PRICE_INDEX_FETCH_ENABLED`;
`GET /price-index/status` says per source when it last fetched, how many rows, and why it
is silent. Endpoint: `GET /price-index/:state?product=`.

### Fixtures recorded today (real bytes, chosen to exercise the refusals, values untouched)

| Fixture (module `__fixtures__/`) | Source | Fetched (UTC) | Rows | Bytes | Format |
|---|---|---|---|---|---|
| `california-abc-beer-2026-09-04.sample.json` | CA ABC beer price posting (AppSync `PricePostings`, Santa Clara county) | 2026-09-04 | 13 of 50+ (Active/Inactive/Old, Retailers/Wholesalers/Manufacturers, ML/OZ/Gallon/Liter, a container charge, a duplicate) | 10,098 | JSON array |
| `iowa-liquor-products-2026-09-01.sample.ndjson` | Iowa Liquor Products (dataset 1029) | 2026-09-04 | 24 of 13,762 | 10,122 | NDJSON |
| `oregon-olcc-pricing-2026-09-01.sample.json` | Oregon OLCC Monthly Pricing (`vmf2-f83h`) | 2026-09-04 | 12 of 3,856 | 5,874 | JSON array |
