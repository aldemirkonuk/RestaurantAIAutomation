---
type: reference
title: Commodity and market index signals — a plan
status: proposed
updated: 2026-09-05
links: ["[[0117-a-price-sighting-names-its-source-its-date-and-its-unit]]", "[[0120-a-goal-comes-from-a-book-a-model-comes-from-the-task]]", "[[0115-the-house-item-is-the-ledgers-key]]", "[[0111-the-calendar-is-the-houses-day-book]]", "[[0083-a-page-may-not-claim-a-write-it-never-makes]]", "[[0048-domain-quant-under-research-math]]"]
---

# Commodity and market index signals — a plan

**Research and a written plan. No code was written and nothing was built.** Every source
below was fetched on **2026-09-05**; the full log, with statuses, byte counts and the
requests that failed, is `p4-scratch/p4as-fetch-log.md`.

The founder's words, 2026-09-05, verbatim:

> a seperate table for index series, + just came to my mind, for addition we could also
> look for indexes in the stock market for those essential goods such as eggs... (tell me
> about plan for this) -> hence, we will understand certain price changes beforehand or
> with triggers of a uprise might give our assistant to alert owners to stock up

---

## Retire-to-write

This document **supersedes [ADR 0111](../decisions/0111-the-calendar-is-the-houses-day-book.md)'s
rejected-alternative paragraph "Public commodity indexes on the price mark"
(`0111…:542`) and closes its fork E (`0111…:592`).** That paragraph filed the question
as a fork on the strength of one source (USDA My Market News) and one argument (a
national terminal price is not a price this house can be quoted). The founder answered
fork E on 2026-09-03 — *"in, as a separate register that never sits beside a vendor
quote"* — and the paragraph has been the only written account of what a public index is
worth here ever since. It stops being that. ADR 0111 keeps its job: the day-book's price
mark and its 30-day median. **The pointer into ADR 0111 is owed and outside this
session's paths** (that ADR belongs to the calendar builder), and is listed as owed
below.

It also **absorbs the *use* half of `price-sources.md`'s class-E table.** That registry
keeps its job — the census of every source and what happened when it was actually
fetched — and stops being the place anyone reads to learn what a class-E series may be
compared to, alerted on, or shown as. Its four class-E rows (USDA My Market News, the
AMS legacy report files, the BLS Public Data API, USDA ERS) are cited here rather than
restated.

**Measured, so the retirement is honest rather than assumed.** `grep -rln -i
"commodity\|commodities" .planning/` on this tree returns six files:
`03-scenarios/S08-vendor-price-drift-over-time.md` (two lines, both naming the
*attribution* problem this plan solves), `decisions/0111-…` (four lines, retired above),
`decisions/README.md` (0111's index row), `decisions/annex-0103-0104-adversary.md`,
`07-reference/ANALYTICS_FEATURE_CATALOG.md:924` (the phrase "commodity POS reports",
unrelated), and `06-pages/calendar.md:371` (a restatement of 0111's call). **There is no
existing commodity or futures plan in the corpus to merge.** `FUTURES.md` §8 is "Ask AI —
action creation" and names no external price signal at all — read in full, 2026-09-05,
lines 203-250.

**Owed and outside this session's paths:** a pointer in ADR 0111 §"Rejected
alternatives" and against fork E; a line in `06-pages/calendar.md` §2c; a row for
`price-sources.md` in `07-reference/INDEX.md` (owed since 2026-09-04 by that file's own
statement in its own retire-to-write block: *"Owed and outside this session's paths: a row in
`07-reference/INDEX.md` pointing here"*).

---

## 1. The founder's question, answered first

**For eggs specifically there is no stock-market index, and the reason is historical and
final.** Eggs were one of the Chicago Mercantile Exchange's founding contracts — the
exchange opened in 1898 as the *Chicago Butter and Egg Board* — and the contract was
delisted. Eggs are now a pure cash market: refrigeration and year-round production left
no carry, and without carry a forward price has nothing to anchor to
(`https://commodities101.morgandowney.com/commodities/eggs`, fetched 2026-09-05;
secondary, and marked as secondary). The number the industry actually runs on is a
**private** benchmark — Urner Barry's shell-egg quotations, now published under Expana —
and commercial egg contracts are written as formulas against it. StoneX sells an OTC
shell-egg contract into that gap and says so in its own words: *"the shell eggs market
has historically lacked standardized financial instruments"*
(`https://www.stonex.com/en/business/financial-glossary/egg-market/`, 2026-09-05).
`www.urnerbarry.com` now 301s to `www.expanamarkets.com` (measured); `www.expana.com`
does not resolve from this environment.

**The free public equivalent exists, is live today, and is better than an exchange price
would be for this purpose.** USDA AMS publishes the *Daily National Shell Egg Index
Report (5-day rolling average)*. Fetched 2026-09-05: **HTTP 200, 257,732 bytes**, sha256
`bae84ef11f48219f39e264c17a062c72aee615c8d6afc84721483de5d5714aa5`, headed **"Fri Sep 4,
2026"** and **"Report for: 09/04/2026"**, stating its own unit and trade level on the
face of the table — *"Caged 30-Dozen Cases / Cents Per Dozen / FOB"* — with class, colour,
size, volume, price range, weighted average, change, last-reported and year-ago columns.
Graded loose, white, Large: **weighted average 35.28 cents per dozen, change -0.86, year
ago (9/5/2025) 215.53**. Cross-checked in prose against the same agency's *Egg Markets
Overview* the same day: *"Wholesale prices for national trading of truck lot quantities
of graded, loose, white Large shell eggs were down $0.04 at $0.35 per dozen"*, with New
York formula trading at $0.84, the Midwest delivered-to-warehouse price at $0.66, the
price to producers at $0.48 and the California benchmark at $1.09.

That row carries every one of [ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)'s
five admission facts — the number, the publisher, the publication date, the unit, and
where it is a price — which is more than most of the drink sources in the registry
manage.

**The generalisation, and it is the whole design.** For the goods a restaurant buys, the
exchange-traded contracts (wheat, corn, soybeans) sit several processing stages *upstream*
of the line on the invoice, while the government market-news reports are *the wholesale
price of the thing itself*. A wheat future does not tell a kitchen what flour will cost;
a shell-egg index tells it what eggs cost, because eggs are barely processed. **This plan
therefore does not buy futures data. It reads published wholesale and index series, and
it treats the distance between a series and the invoice as a first-class property of the
mapping rather than as a detail.**

---

## 2. What is actually traded or published, measured

`Class` is [ADR 0117](../decisions/0117-a-price-sighting-names-its-source-its-date-and-its-unit.md)'s
class E (public index) throughout unless marked. `Verified` follows the registry's
convention: `yes` means bytes were fetched and read on 2026-09-05, `partial` means
something adjacent was measured, `no` means the fetch failed and the reason is stated.

### 2a. Free public series — the ones a plan can actually be built on

| Source | What it publishes | Cadence | Machine access | Issuer + date on the row? | Terms / licence | Rate limit | Verified 2026-09-05 |
|---|---|---|---|---|---|---|---|
| **USDA AMS Daily National Shell Egg Index** | National FOB wholesale shell-egg weighted averages by colour, class and size; caged and cage-free; regional volume movement | **daily** | PDF at `www.ams.usda.gov/mnreports/ams_2843.pdf`; the same report is `viewReport/2843` on My Market News | **yes** — "Fri Sep 4, 2026", "Report for: 09/04/2026", "Cents Per Dozen / FOB", USDA AMS Livestock, Poultry & Grain Market News | US Government work; **the host's own terms were not read** — see the rate-limit cell | **`www.ams.usda.gov/robots.txt` returned HTTP 403** (Akamai, reference `#18.a4ed2117.…`) | **yes (three one-off research reads)** — and see §3c: **its crawl rules cannot be read, so no scheduled fetcher may be pointed at this host** |
| **USDA AMS legacy report files, generally** | Everything AMS Market News publishes, per report id | varies | `www.ams.usda.gov/mnreports/ams_<id>.pdf` | yes | as above | as above | **yes.** `ams_2140.pdf` fetched: 241,994 B, a Virginia feeder-cattle board sale dated **Thu Aug 13, 2026** — so this path is **not** uniformly frozen, correcting the impression left by `bh_fv020.txt`'s 975-day-stale file. Live and dead reports share one path and are told apart only by their own dates |
| **USDA My Market News / MARS API v1.2** | The machine face of everything above: terminal produce, dairy, poultry, eggs | daily | `https://marsapi.ams.usda.gov/services/v1.2` | yes, in the payload | **unread.** Search results describe a free key on registration; that page has now timed out on four consecutive days and **"free" remains second-hand** | unread | **no.** `/services/v1.2/reports` **403** unauthenticated (second day, key requirement confirmed by measurement); `mymarketnews.ams.usda.gov` timed out at 45 s and 60 s over HTTP/1.1 and HTTP/2; `marsapi.ams.usda.gov/robots.txt` **404** |
| **BLS Public Data API v1** | PPI and CPI series, and the **AP average-price series which are prices in dollars, not index numbers** | monthly | `https://api.bls.gov/publicAPI/v1/timeseries/data/` | yes, in the payload, including a `"Preliminary"` footnote | **the terms page named by the FAQ, `bls.gov/bls/termsofservice.htm`, returned 404 — the terms are unread and are not asserted here** | **v1: 25 queries/day, 25 series, 10 years, no key. v2: 500/day, 50 series, 20 years, free annual key. Both 50 requests / 10 s** — quoted from `bls.gov/developers/api_faqs.htm` | **yes, and then a problem.** `APU0000708111` (*Eggs, grade A, large, per doz., US city average*) returned 2026 M07 = **2.189**, M02 = 2.500. `WPU017107` (*PPI, eggs for fresh use*) and `WPU0223` both returned clean. **Then `https://api.bls.gov/robots.txt` returned 200 with `User-agent: * / Disallow: /`** — see §3c. **Q1 CLOSED by the founder 2026-09-05: register a v2 key and use the API under its terms.** One gap that must close before arming: the terms document itself is **unread** — `bls.gov/bls/termsofservice.htm`, the page the FAQ names, returned **404** — so the only BLS terms this plan can currently point at are the published limits in `api_faqs.htm`. **The source row's `terms_url` may not be a 404** |
| **FAO Food Price Index** | A world index of food commodity prices, plus five sub-indices: cereals, vegetable oils, dairy, meat, sugar | **monthly**, on a published calendar | **CSV**, keyless: `www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv` | **yes** — the page states the release date and the next one; the CSV states its own base | **no licence declared on the page.** Footer is "© FAO 2026" with a general terms link. **Unstated, recorded as unstated** | `robots.txt` **200**: `*` disallows `/index.php`, `/t3lib/`, `/typo3/`, `/*?id=*` and two `user_upload` paths. **The CSV path is permitted; no crawl-delay is declared** | **yes.** August 2026 = **133.3**, released **2026-09-04**, next **2026-10-02**. CSV: 48,006 B, sha256 `746104cf…c62f`, 444 lines, base **2014-2016=100**, last row `2026-08,133.3` |
| **ONS time series (JSON)** | UK CPI, including **`d7bu` — CPI INDEX 01: FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100** | monthly | keyless per-series URL: `.../timeseries/d7bu/mm23/data` | **yes** — `releaseDate`, `nextRelease`, and an `updateDate` on **every observation** | **Open Government Licence v3.0** | `www.ons.gov.uk/robots.txt` returns **404** (re-read 2026-09-05T14:12:41Z: 404, 101,929 B, an ONS "Page not found" page with zero `disallow` lines) — unrestricted per RFC 9309, the same reading the registry already applies to `ilcc.illinois.gov` | **yes.** 125,504 B, 463 months, 2026 JUL = **144.0**, `unit: "Index, base year = 100"` |
| **TÜİK SDMX — `DF_TUFE_SDMX_TT01`** | Türkiye CPI by main expenditure group, including **01 food and non-alcoholic beverages** | **monthly**, first days of the following month | SDMX 2.1 REST, `nsiws.tuik.gov.tr/rest`, `?format=SDMX-CSV`; **a Keycloak bearer token is required** | **partly** — the payload states the period and the base and states **no publication date**; `UNIT_MEASURE` is empty on every row | **the site-wide legal notice** at `tuik.gov.tr/Kurumsal/Yasal_Uyari`: re-use permitted *provided the source is cited*. No licence on the service or in the manual. `attribution_required`, and the attribution string is OURS because TÜİK prescribes none | **none stated anywhere.** The 24-a-day ceiling is ours | **yes, with the founder's key, 2026-09-05.** Token `expires_in` 300; `TR.M.2.1._Z.2025.2026_01._Z.01.F_TFE` → **200, 891 B**, sha256 `5760a5fa…`, 8 rows, **2026-08 = 134.31**, base 2025=100. `nsiws.tuik.gov.tr/robots.txt` answers **401** |
| **TÜİK SDMX — `DF_TUFE_SDMX_TT09`** | The same CPI at **325 COICOP-2018 levels**, index only, including three beverage subclasses | monthly | as above; **7,532,768 B / 84,500 rows unbounded** | as above | as above | as above | **yes (keyless route, by the researcher).** `02110`=128.89, `02121`=126.50, `02130`=140.20 at 2026-08. **Their LABELS were never read**: the codelist endpoint answers 401 and the Data Explorer view went blank five times. Registered as codes, `silent: codelist_unread` |
| **USDA ERS Food Price Outlook** | **Forecasts** of annual food price change by category, plus the CPI and PPI series behind them | **monthly, on the 25th**; next **2026-09-25** | CSV and XLSX | yes | not stated on the page; a USDA work | not measured | **partial.** Both pages read. Its own documentation states it *"generates 95 percent forecast intervals"* — **the only source in this register that publishes an interval rather than a point** |
| **Defra wholesale fruit and vegetable prices** | England and Wales wholesale produce, GBP per kg | fortnightly | CSV | yes, a date on every row | **OGL v3.0** | — | **Measured by the market-research builder on 2026-09-05 and already built as `parse-defra.ts`.** Cited, not re-fetched. See `price-sources.md` §"United Kingdom — one found" |
| **EIA open data (diesel, natural gas)** | The input cost under every delivery and every kitchen | daily to monthly | REST v2, JSON | yes | *"EIA data is provided free of charge"* subject to its API Terms of Service and Copyrights and Reuse Policy | **free key required**; `api.eia.gov/robots.txt` answers `403 API_KEY_MISSING`; JSON max 5,000 rows, XML 300; throttle limits **not stated on the documentation page** | **partial.** Documentation read; no series pulled |

### 2b. Exchange and vendor data — what it costs and what it would buy

| Source | What it is | Verified 2026-09-05 | Finding |
|---|---|---|---|
| **CME Group** | Wheat, corn, soybean oil, Class III milk, cheese, butter, live and feeder cattle, lean hogs; the dairy complex is the only part a restaurant buys near-directly | **no** | **Five attempts, three methods, four URLs — every one timed out**: the licensing-fees page, the market-data FAQ, the Class III milk product page, and `robots.txt` over both HTTP/2 (`INTERNAL_ERROR`) and HTTP/1.1. **CME's market-data terms are unverified from this environment, never unavailable.** Nothing about exchange licensing is asserted in this plan on the strength of a search summary |
| **ICE** | Coffee C, Sugar No. 11, Cocoa — the softs a bar and a pastry section buy | **partial** | `robots.txt` **200, 308 B**, permissive. `ice.com/market-data/pricing-and-analytics` **200** and describes evaluated pricing, reference data and consolidated feeds — **and states no terms at all for commodity futures prices.** Per-contract pages not fetched: the licensing answer would have to be compared against CME's, and CME could not be reached |
| **Nasdaq Data Link** | The usual free-tier route to exchange and macro series | **partial** | `data.nasdaq.com/publishers/QDL` **200** but only the page title reached the reader. `docs.data.nasdaq.com/docs/getting-started` **200**: free versus premium described, *"free data is suitable for experimentation and exploration"*, **and neither a rate limit nor a key requirement is documented on that page** |
| **Alpha Vantage** | A free API with WTI, Brent, natural gas, copper, aluminium, wheat, corn, cotton, sugar, coffee and a "Global Commodities Index" | **yes, and it fails the admission test** | `function=WHEAT` returned `{"name":"Global Price of Wheat","unit":"dollar per metric ton"}` with 2026-07-01 = **228.73884495**. That is **byte-identical to FRED's `PWHEAMTUSDM`** for the same month. So it is republished IMF/World Bank data — **with the issuer and the release date stripped out.** The payload names no publisher and carries no publication date, so **no row from it could ever enter the register** under ADR 0117. Documentation says *"For commercial use, please contact sales"* |
| **FRED (St. Louis Fed)** | The cleanest aggregator of public commodity and macro series | **yes** | API terms read in full. A key is required. A mandated notice must appear on the application: *"This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."* And the load-bearing clause: *"Data series available through the FRED® API, may be owned by third parties and subject to copyright restrictions… Before using data series owned by third parties for anything other than your own personal use, you must contact the data owner."* **So FRED is not a licence laundry.** `robots.txt` **200**, `Crawl-delay: 1`, and `/graph/fredgraph.csv` is **not** disallowed — the keyless CSV route works (12,462 B measured) but returns **two columns and no metadata at all**, so it fails the same admission test Alpha Vantage fails |
| **Yahoo Finance** | The obvious free source of futures quotes, and the one to say no to loudly | **yes (as a negative)** | Yahoo's terms, read verbatim today, prohibit *"access or collect data … using any automated means, devices, programs, algorithms or methodologies, including but not limited to robots, spiders, scrapers"* and prohibit using material to *"create any database, archive, mobile application, data feed, widget or any other aggregated data source that competes with or constitutes a material substitute for the Services"*, and state *"you may not access or reuse the Services, or any portion thereof, for any commercial purpose."* **Closed three separate ways. This product may not read Yahoo Finance** |

### 2c. Türkiye and the United Kingdom

Both were re-measured on 2026-09-05 by the market-research builder and the results are in
`price-sources.md` §"Türkiye and the United Kingdom, re-measured 2026-09-05". **Nothing
here re-crawls those hosts.** What this plan adds is two facts measured today:

- **CORRECTED 2026-09-05, and this sentence is superseded: Türkiye HAS a machine-readable
  index and it is now armed.** What this paragraph said next was true of a fetcher without a
  credential, and stopped being the whole story the moment there was one. TÜİK runs a
  documented SDMX 2.1 REST service at `https://nsiws.tuik.gov.tr/rest`; the founder minted a
  personal API key in the Veri Portalı on 2026-09-05, and the exchanged token read
  `DF_TUFE_SDMX_TT01` — CPI, food and non-alcoholic beverages, base 2025=100, 2026-08 =
  **134.31** — HTTP 200, 891 bytes. §2a and §10 carry it; the original observation below is
  kept because it is what a KEYLESS reader still sees. `veriportali.tuik.gov.tr/robots.txt`
  is **200** and names `anthropic-ai`, `ClaudeBot`, `ClaudeUser` and `Claude-SearchBot` in
  an explicit allow group — the only source in either register that permits us by name —
  and the portal behind it renders "JavaScript Required" with token-signed downloads and
  no stable series URL. `evds2.tcmb.gov.tr` 302s to `evds3` and serves a **1,355-byte
  JavaScript shell**; TCMB EVDS is unchanged from 2026-09-04 and stays **unverified**.
  The one live, dated Turkish price source in the corpus is the HKS hal produce bulletin,
  which the registry records as `silent: no_machine_endpoint`.
- **The UK has one usable index line beyond Defra**, and it is `d7bu` above.

---

## 3. What the licences actually say

### 3a. The four states a licence can be in, and why a boolean would lie

The registry has already met all four. A source's terms are **permitted** (ONS and Defra,
OGL v3.0), **attribution required** (Iowa, CC BY 4.0 — the attribution travels on the
row), **prohibited** (AHDB, whose terms forbid third-party publication and limit use to
*"internal business purposes only"*, so putting an AHDB number on a tenant's screen is
publication), or **unstated** (Oregon, FAO, michigan.gov — recorded as unstated, never as
permissive). A `redistribution` column with those four values, on the series row, is what
lets a series be fetched for the house's own analysis and still be refused a place on the
screen. A boolean would collapse `prohibited` and `unstated` into the same silence.

### 3b. Exchange data is licensed, and this plan does not need it

Nothing in §2b would improve the alert. Every futures contract a restaurant could
plausibly care about is either upstream of the invoice by several processing stages
(wheat, corn, soybean oil) or is a dairy contract whose cash settlement references a USDA
survey we can read for free. **The measured position is that the licensing question does
not have to be answered to build this**, and CME's own terms could not be read today
anyway. Phase 2 is where it would be answered, and §10 states what would have to be true
first.

### 3c. Two politeness findings that change the phasing, and one shortcut declared

**`www.ams.usda.gov/robots.txt` returns HTTP 403.** Under this repo's own rule — recorded
in `price-sources.md` for K&L Wine Merchants (*"Its crawl rules cannot be read, so nothing
may be fetched"*) and for Majestic and Tesco — **no scheduled fetcher may be pointed at
that host.** **Four one-off research requests across three distinct URLs** were made
here (`ams_2140.pdf` was fetched twice, once to identify it and once to extract its text),
matching the 2026-09-04 precedent that read `bh_fv020.txt` from the same host and recorded
it; they are records, not a licence to crawl. **Corrected 14:12Z**: this paragraph said
"three one-off research reads" until the fourth request was found by a sweep of the fetch
log against the transcript. The consequence is in §10: the shell-egg index takes the
**Michigan path** — a parser written against a real recorded fixture and an upload
endpoint, never a fetch.

**`api.bls.gov/robots.txt` returns 200, 26 bytes, whose entire body is `User-agent: *`
and `Disallow: /`.** Read twice: once during the research run, and again at
**2026-09-05T14:12:41Z** at an auditor's instruction, byte-identical, sha256
`331ea9090db0c9f6f597bd9840fd5b171830f6e0b3ba1cb24dfa91f0c95aedc1`. **The first read was
made and then omitted from the fetch log**, so until 14:12Z this section's central finding
had no logged evidence behind it; the omission and the sweep that found its siblings are
recorded in `p4-scratch/p4as-fetch-log.md` §"Correction". That is a
`Disallow: /` on the host of a documented, key-issuing, rate-limited public API. The
registry's existing precedent (Metro Türkiye: *"A polite fetcher may not read this source
at all"*) says that closes it. The counter-reading is that robots.txt governs crawlers
and an API whose publisher documents it, publishes its limits and issues keys for it is
governed by its own terms instead. **The founder took the second reading on 2026-09-05:
*"Register a key, use the API under its terms."* The API's terms are the specific
permission and the robots file the general one. Q1 is CLOSED; see §12 Q1 for the decision,
the two rejected paths and what the source row must then carry, and §10 for the phase that
arms it — which is not phase 0.**

**The shortcut, declared per CLAUDE.md §0.5 — and corrected upward at 14:12Z.** Data
requests were made to `api.bls.gov` **before** its `robots.txt` was read, and the read came
back `Disallow: /`. The order was wrong. **This document first said "seven requests"; a
recount against the four python scripts that ran puts the true figure at two GETs plus
eleven or twelve POSTs — thirteen or fourteen data requests, against the v1 keyless tier's
25-per-day limit.** The range is genuine: the script that raised `ValueError: could not
convert string to float: '-'` does not say from its traceback whether it failed on the
2016-2025 pull or the 2026 one, and that is not resolved by guessing. No data request was
made to that host after the read; every BLS number in this document comes from those
thirteen or fourteen, and the only later request was the 14:12Z re-read of `robots.txt`
itself.

---

## 4. What the state of the art does

| Product | What it is | What it does about price rises | Measured 2026-09-05 |
|---|---|---|---|
| **Expana** (Urner Barry + Mintec + Feedinfo + Stratégie Grains) | *"the world's leading agrifood-focused Price Reporting Agency"* | **"2,600+ Time series forecasted"**, "Commodity alerts", "Commodity price forecasts", a "Data Direct API" | `www.urnerbarry.com` **301s to `www.expanamarkets.com`**; that page **200**. No price is visible without a subscription and **no price is published for the subscription** |
| **Mintec** (inside Expana) | Commodity price and market data for food buyers | **"600+ Price Forecasts"**, described as *"Delivering future price predictions and hedging recommendations"* | **200**. "18,000+" curated prices, "70 million+" data points a year. Demo-gated; no published price; the site makes **no explicit alerting claim** |
| **ArrowStream CommodityONE Market Basket** (Buyers Edge) | **The closest published analogue to what the founder asked for** | Announced **2024-04-08**: it *"leverages the extensive commodity intelligence resources of CommodityONE, combined with an operator's historical pricing data to deliver cost modeling by item"*, with *"item-level precision, providing product-specific price forecasts"* and *"year-over-year insights, enabling them to anticipate both inflationary and deflationary trends"*, drawing on *"detailed forecasts for over 250 markets"* | **200.** And note what the announcement does **not** contain: **no forecast horizon, no alert feature, and no accuracy claim of any kind.** The market leader in exactly this product ships item-level commodity forecasts and publishes no measure of whether they are right |
| **StoneX** | A broker selling the hedge the exchange no longer lists | An OTC shell-egg contract, financially settled, referencing the Urner Barry by Expana egg index | **200.** *"In recent years price volatility in the egg market has increased due to fluctuating demand as well as supply side disruptions such as avian influenza outbreaks, rising feed costs"* |
| **Datassential, Tastewise** | Food and menu trend intelligence | Not price sources | `robots.txt` **200** on both. Tastewise's begins *"AGENTS WELCOME"* and allows `ClaudeBot`, `Claude-User`, `Claude-Search` by name. Recorded because it is unusual, not because it is a price |
| **Bloomberg** | Terminal food and agriculture indices | — | **Not fetched. Recorded as unexamined, not as absent** |

**The single most useful thing in this table is a negative.** The category leader ships
item-level commodity forecasts to 105,000 restaurant locations and publishes no accuracy
figure. Under [ADR 0083](../decisions/0083-a-page-may-not-claim-a-write-it-never-makes.md)
this product may not do the same, so §9 states the rule's firing rate from measurement and
§9d states plainly which number cannot yet be stated at all.

---

## 5. The honest limit: what a rising index does and does not predict

This section exists because the founder's sentence contains a claim — *"we will understand
certain price changes beforehand"* — and the literature is specific about when that is
true and when it is not.

### 5a. A future is an expectation, not a forecast

An exchange settlement is the price at which the marginal buyer and seller agreed today
for a delivery later. It embeds carry, storage, financing and risk premium. It is not a
prediction and it has no published error. Nothing in this plan turns a curve into a
forecast, and the assistant never says a future "predicts" anything.

### 5b. Pass-through is partial, and it is measured

USDA ERS, *Food Commodity Cost Pass-Through*, Roeger and Leibtag, **2011-06-16**, read in
full today. Verbatim:

- *"wholesale beef prices reflected an average of 53 percent of a typical change in cattle prices"*
- *"wholesale prices of wheat flour reflected, on average, 30 percent of the change in farm-level wheat prices"*
- *"Retail beef prices incorporated 19 to 29 percent of a typical change in wholesale beef prices"*
- *"retail bread prices incorporated 16 to 21 percent of the change in wholesale wheat flour prices"*

and on timing, *"most of the change in response to farm prices was passed on to wholesale
prices within the first month"*, while at retail the response took two months for beef and
two to four months for bread on modest moves, compressing into the first month on sharp
increases. **Compounded, a 10 percent move in farm wheat reaches retail bread as roughly
0.5 to 0.6 percent.**

### 5c. The government's own model uses lags of many months

USDA ERS Technical Bulletin **TB-1940**, *How USDA Forecasts Retail Food Price Inflation*,
Kuhns, Volpe, Leibtag and Roeger, **May 2015**, extracted and read today. Its
autoregressive distributed lag models *"allow for lags as long as 12 months"*, chosen by
the Hannan-Quinn criterion. The published optimal lag distributions: **fresh vegetables 1,
2, 6, 9, 10 and 11 months; fresh fruit 1, 6, 7 and 10 months; the diesel PPI 1, 2, 4, 5, 7
and 8 months.** These are the horizons at which the issuer itself believes an upstream
price reaches a retail one.

### 5d. And the strongest evidence available says the effect is small and imprecise

Federal Reserve Bank of Kansas City Research Working Paper **RWP 24-16**, *The Passthrough
of Agricultural Commodity Prices to Food Prices*, Scott, Lusompa, Rodziewicz, Cowley and
Dice, **December 2024, updated October 2025**, doi `10.18651/RWP2024-16`. Extracted and read
today. Its abstract: *"Our results suggest that the passthrough from row crops to food at
home inflation is small and imprecisely estimated. These results reinforce the perspective
that agriculture commodity prices are not a principle driving factor behind consumer food
prices in the United States."*

From the results section, verbatim:

- Row crops to food-at-home CPI: the impulse response *"starts to increase after one year,
  and about 2 years to ease"*, and *"the wide confidence intervals around those estimates
  implies that any given shock in row crop prices are not guaranteed to passthrough
  positively to food inflation"*.
- Wheat to bakery CPI: *"A 1% increase in wheat prices takes less than 20 months to
  dissipate, and the point estimate of the impulse response shows that the shock takes less
  than 10 months to meaningfully impact Bakery CPI."*
- Soybeans to fats and oils CPI: the impact *"ease after 2 years"*, on a weak instrument
  (F ≈ 4).
- And the sentence that forecloses the obvious rebuttal: *"one may be concerned that our
  SVAR may not be fully capturing the effects of expectations in row crop prices. To
  mitigate these concerns, **we include futures prices in the SVAR and results remain
  qualitatively the same**."*

**Read plainly: for a row crop, an alert that fires today about a price the house will pay
next week is not supported by the evidence. The horizon is a year.**

### 5e. The distinction that rescues the founder's idea, and it is measured on eggs

The papers above are about **processed** food — bread from wheat, oil from soybeans. The
founder's example is not processed. Eggs go from the barn to the case with a wash and a
grade, and the USDA index **is the wholesale price of the case**, not a proxy for it.

The size of the gap between those two situations, measured on one commodity today:

| | Number | Source, measured 2026-09-05 |
|---|---|---|
| National wholesale, graded loose, white Large, FOB | **$0.35 per dozen** | USDA AMS, `ams_2843.pdf`, report for 09/04/2026 |
| Retail, grade A large, US city average | **$2.189 per dozen** | BLS `APU0000708111`, 2026 M07 |
| Ratio | **6.3x** | — |
| The same wholesale series, one year earlier | **215.53 cents = $2.16 per dozen** | the report's own "Year Ago (9/5/2025)" column |
| Year-on-year change | **−83.6 %** | — |

Two months apart, two trade levels, two products (loose FOB versus cartoned retail). They
are not comparable, and a page that placed them side by side would be publishing an
invented margin — which is why classes never mix. But the *shape* is the finding: on the
same commodity, in the same year, the wholesale series moved by more than eighty percent
while retail did not. **A house buying loose cases lives on the first line. A house
buying cartons lives somewhere between.** Which line a given house lives on is not
knowable from the series; it is knowable only from that house's own invoices. That is
§8's job.

**So the honest scope of the alert is: goods where the published series is the wholesale
price of the thing the house buys.** Eggs, wholesale produce, butter, cheese, fluid dairy,
and the market-news protein reports. Not bread, not cooking oil, not anything the house
buys as a manufactured product.

---

## 6. Why the index series needs its own table — five measured reasons

The founder decided this in batch 37 (*"a seperate table for index series"*). It is right,
and it does not rest on preference. Measured against
`supabase/migrations/20260904200000_a_posted_price_names_its_state.sql` on this tree,
**five independent columns of `price_index_postings` each make an index series unwritable**:

| Column, as declared | Why an index series cannot satisfy it |
|---|---|
| `price NUMERIC(12, 2) NOT NULL CHECK (price >= 0)` | An FAO index of 133.3 is not a price. And `NUMERIC(12,2)` would round `PWHEAMTUSDM`'s 228.73884495 to two places, silently discarding precision the issuer published |
| `currency CHAR(3) NOT NULL DEFAULT 'USD'` | An index number has no currency, and the default would stamp it `USD` — the exact class-A defect already recorded in `price-sources.md` §"What a house's own paper can do first", whose closing line is *"The absence of a currency is reported as a currency"* |
| `price_unit VARCHAR(24) NOT NULL CHECK (btrim(price_unit) <> '')` | ONS `d7bu`'s own declared unit is `"Index, base year = 100"`. That is not a price unit, and it is 26 characters |
| `product_name VARCHAR(300) NOT NULL` | A series names a commodity class, not a product. Writing one in would assert a product identity the issuer never published |
| `state VARCHAR(12) NOT NULL CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$')` | The FAO index is global. `WORLD` fails the regex, and there is no ISO 3166-2 code for "everywhere" |

This is also, independently, why the market-research builder registered Defra (a price)
and did **not** register ONS `d7bv` (an index number) — recorded in `price-sources.md`'s ONS row: *"an index number, not a price, and `price_index_postings` requires a price with a currency and a unit"*.
That decision was correct and this table is what unblocks it.

---

## 7. The shape: two tables, not one

A series' licence, issuer, cadence and unit are properties of the **series**; repeating
them on every observation is how a licence goes stale without anyone noticing. So: one row
per series, one row per observation.

### 7a. `commodity_index_series`

| Column | Type | Why |
|---|---|---|
| `id` | `uuid` PK | |
| `series_key` | `text NOT NULL UNIQUE` | our stable key, e.g. `usda_ams.shell_egg_index.national.loose.white.large` |
| `issuer` | `text NOT NULL` | free text; the issuer is an agency, not an FK — `price_index_postings`' own reasoning |
| `issuer_jurisdiction` | `text NOT NULL` | ISO 3166 where one applies, and the literal `WORLD` where it does not. **The column `price_index_postings` could not have** |
| `series_title` | `text NOT NULL` | the issuer's own title, verbatim |
| `source_url` | `text NOT NULL` | |
| `value_kind` | `text NOT NULL` CHECK `{price, index_number, rate, forecast}` | **the column that makes the table honest.** An index number may never be rendered as a price; a rate (HMRC duty, ÖTV, the Illinois gallonage tax) may never be rendered as either; a forecast (ERS) must carry its interval |
| `unit` | `text NOT NULL` | the issuer's own unit string, verbatim: `cents per dozen`, `Index, base year = 100`, `GBP per kg` |
| `currency` | `char(3) NULL` | CHECK: `NOT NULL` when `value_kind = 'price'`, `NULL` otherwise. No default, ever |
| `price_basis` | `text NULL` | `FOB`, `delivered to warehouse`, `to producers`, `retail city average`. The column that stops a producer price being compared to a retail one |
| `cadence` | `text NOT NULL` + `max_age_days integer NOT NULL` | the staleness gate's input, per source, as `price-index/registry` already does |
| `licence` | `text NOT NULL` | verbatim, or the literal `unstated` |
| `attribution` | `text NULL` | the string that must travel with the number (the Iowa CC BY 4.0 precedent) |
| `redistribution` | `text NOT NULL` CHECK `{permitted, attribution_required, prohibited, unstated}` | §3a. A `prohibited` series may be fetched and may never be shown |
| `robots_url`, `robots_read_at`, `robots_sha256`, `robots_verdict` | `text` / `timestamptz` / `text` / `text` | **Required by the founder's Q1 decision of 2026-09-05**: the source row records the robots reading *with its time and its hash*. `robots_verdict` holds what it actually said (`disallow_all`, `permits_path`, `unreadable`, `absent`), so a source admitted **against** a `Disallow: /` is visibly admitted against one rather than quietly. BLS's row would read `disallow_all` with sha256 `331ea909…` — the honest shape of a decision to proceed on the API's terms |
| `terms_url`, `terms_read_at`, `terms_basis` | `text` / `timestamptz` / `text` | The other half of the same decision: **the terms the row relies on**, by URL, with when they were read and the specific permission relied on, verbatim. A `terms_url` that 404s is not a term — see the BLS row in §2a |
| `access_key_required`, `key_env_var`, `fetch_user_agent` | `boolean` / `text` / `text` | The key is a fact about the source, never a committed value; the User-Agent carries a contact URL so a publisher can block us deliberately rather than by accident, which is ADR 0117's existing rule |
| `daily_request_budget` | `integer NULL` | **My rendering of the founder's *"stays under the daily limit"*, not their words.** A number the fetcher counts against, refusing rather than exceeding. It exists because I demonstrably needed it: §3c records that I spent **13-14 of the v1 tier's 25** on a research pass while believing I had spent 7 |
| `rise_threshold` / `step_guard` | `numeric NULL` | derived from the series' own history — §9b. **NULL means the rule cannot fire for this series**, and that is said out loud |
| `threshold_window_from` / `_to` / `_n_obs` / `_computed_at` | | so the number on the screen can be traced to the window that produced it |
| `access_key_required` / `key_env_var` | `boolean NOT NULL DEFAULT false` / `text` | **Added 2026-09-05 for TÜİK, the first source read WITH a credential.** The register names the VARIABLE and never the key: a register that stored one would be a register that leaks one. A CHECK requires the pair to move together and requires the name to be shell-shaped, which a pasted credential is not. **Holding a key says nothing about `redistribution`** — a publisher letting us read is not a publisher letting us publish |
| `robots_reading` | `text` | What the host said when ASKED. Four distinct answers now exist across this register — 200 with rules (FAO), 404 absent (ONS), 403 refused (USDA AMS), **401 unauthenticated (TÜİK `nsiws`)** — and flattening any into another is a different claim about a different publisher |
| `user_agent` / `request_budget_per_day` | `text` / `integer` | The identity we present, on the row rather than in a constant. And a ceiling that is **OURS**: TÜİK states no rate limit anywhere, and a source with no stated limit is exactly where a runaway loop does its damage. A budget of zero is refused — that is `admission`, not a budget |
| `licence_url` | `text` | Where the words in `licence` were read. TÜİK's re-use sentence lives in a Turkish site-wide notice the English site does not link to |
| `armed` | `boolean NOT NULL DEFAULT false` | |
| `withheld_reason` / `silent` | `text NULL` | mirroring `price-index.registry.ts`'s existing distinction: unreadable versus read-but-unusable |

### 7b. `commodity_index_observations`

| Column | Type | Why |
|---|---|---|
| `series_id` | `uuid NOT NULL REFERENCES commodity_index_series(id)` | |
| `period_start` | `date NOT NULL` + `period_grain text NOT NULL` CHECK `{day, week, month, quarter, year}` | the observation's own period, never our clock |
| `value` | `numeric(18, 8) NOT NULL` | wide enough for `228.73884495`; a rounded series is a different series |
| `issued_at` | `timestamptz NOT NULL` | the issuer's publication date |
| `issued_at_basis` | `text NOT NULL` CHECK `{issuer_stated, fetch_date}` | **reusing ADR 0117 Q27's decided column and vocabulary exactly**, so `refuseStale` ages a fetch-dated row from the read and the screen prints "read on" rather than "issued" |
| `fetched_at` | `timestamptz NOT NULL` | |
| `vintage` | `text NULL` CHECK `{preliminary, final, revised}` | **measured need**: BLS returned `WPU0223` 2026 M07 flagged *"Preliminary. All indexes are subject to monthly revisions"* for four months. A revision that silently overwrote a preliminary value would rewrite the history an alert already fired on |
| `source_ref`, `content_hash` | `text NOT NULL` | UNIQUE `(series_id, period_start, source_ref, content_hash)` — the same dedup shape as `price_index_postings`, so a re-read of an unchanged observation dedups and a revision is a new row |

**No `restaurant_id`.** The register is public and keyed by series, exactly as
`price_index_postings` is keyed by state, and the endpoint scopes it at read time.
RLS on, `service_role` only, anon and authenticated revoked in the same migration, with an
in-file `DO` block asserting all of it — the shape `check_new_tables_are_locked_down.py`
requires and `20260904200000` already proved on a live local Postgres.

---

## 8. The mapping: which series moves this house's item

A house buys "eggs, large, case of 15 dozen". No series knows that. The join is an
assertion, and it is the part most likely to be got wrong quietly.

### 8a. `house_item_commodity_exposure`

| Column | Type | Why |
|---|---|---|
| `restaurant_id`, `house_item_id` | `uuid NOT NULL` | `house_item_id` references **`public.restaurant_inventory(id)`** — [ADR 0115](../decisions/0115-the-house-item-is-the-ledgers-key.md)'s key, and the table that **exists today** (`…baseline_from_production.sql:3259`). It deliberately does **not** reference the `house_items` view, which ADR 0115's migration is written for and which is **not applied** |
| `series_id` | `uuid NOT NULL` | |
| `pass_through` | `numeric(4,3) NULL` | the share of a series move expected to reach this item's invoice price |
| `pass_through_basis` | `text NOT NULL` CHECK `{issuer_published, house_measured, unset}` DEFAULT `unset` | **`unset` is the honest default and it is the common case.** With `unset`, the assistant says the series moved and says it does not know how much of that reaches this item |
| `lag_days`, `lag_basis` | same three-state shape | §5c's numbers are `issuer_published`; a house's own regression once it has invoices is `house_measured` |
| `asserted_by` | `uuid NOT NULL` | a person, from **`public.users.user_id`** — never `auth.users`, which is disjoint from it and would 23503 on every write |
| `asserted_at`, `note`, `retired_at` | | retirement, not deletion — ADR 0115's rule |

### 8b. Four rules the mapping lives by

1. **Never inferred.** No model proposes an exposure. The catalogue leader's own product
   does exactly this inference and publishes no accuracy figure (§4); this product may not.
2. **Absence is said.** Where no live exposure exists, the item's panel reads *"no
   commodity series is mapped to this item"* — [ADR 0051](../decisions/0051-rebuilt-pages-show-live-data-only.md)'s
   rule, and the difference between *stable* and *unobserved* that ADR 0111 §2c already
   names as "the entire ADR 0020 fault".
3. **FNDDS does not solve this, and it should be said before someone tries.** FNDDS is a
   free public-domain **dish to ingredient** BOM — 18,584 ingredient rows, 5,431 dishes,
   976 with an explicit cooking moisture change (ADR 0048; `FOOD-REASONING-GRAPH.md:146`).
   It is layer L2 in that graph. **It contains no ingredient-to-price-series concordance
   and never will**, because it is a nutrition instrument. It will matter later, when a
   dish's exposure is computed from its ingredients' exposures. It does not seed this
   table.
4. **Top N by spend, typed by a person.** The first fill is the N house items with the
   largest twelve-month purchase value, each typed once. Where the house has no purchase
   history the list is empty and says so.

---

## 9. The alert rule, and its arithmetic

Shaped to fit both existing engines without inventing a third: a `rule(key, fired, make)`
entry in `analytics/recommendations.service.ts` (which today evaluates twelve rules), and a
producer beside the eight in `notifications/producers/` — modelled directly on
`market-signal.ts`, which is the closest existing thing and is pure, testable and already
states its own thresholds' provenance.

Rule key: **`commodity_exposure_rising`**.

### 9a. The arithmetic

All quantities come from **one** series `s` and its own admitted observations. Nothing is
normalised across series and nothing is converted.

```
  v_t        value of the newest admitted observation of s, at period t
  v_(t-1)    the observation immediately before it
  K          baseline length, in OBSERVATIONS not days          default 12
  B          median( v_(t-1-K) … v_(t-2) )
             the baseline: the median of the K observations
             ending one period before t
  m          (v_t - B) / B          the move, as a fraction of the baseline
  j          | v_t / v_(t-1) - 1 |  the single-step jump
  X_s        this series' rise threshold      derived, 9b
  J_s        this series' step guard          derived, 9b
  W_s        the quiet window, in days        default 14
  N          coverage floor, in days          default 21
```

**A median, not a mean**, for the reason `flagOutliers` already uses a median absolute
deviation: one revised observation moves a mean and does not move a median.

**K counts observations, not days.** A 90-day baseline on a monthly series is three
points. This is the mistake the Michigan cadence correction already caught once, in the
other direction — `maxAgeDays` 62 on a 91-day cycle.

The rule fires when **all nine** hold:

| | Condition | Refusal reason when it does not |
|---|---|---|
| 1 | at least `K + 2` admitted observations exist for `s` | `too_short_a_history` |
| 2 | `j <= J_s` | `implausible_step` |
| 3 | `m >= X_s` | `below_floor` |
| 4 | `series.redistribution <> 'prohibited'` | `may_not_be_published` |
| 5 | not stale: `issued_at` within `max_age_days`, aged from `issued_at` when `issued_at_basis = 'issuer_stated'` and from `fetched_at` when it is `'fetch_date'` | `stale` |
| 6 | at least one live exposure joins this house's item to `s` | `no_exposure_mapped` |
| 7 | that item's days of inventory `< N` | `already_covered` |
| 8 | the item is storable for at least the exposure's lag | **blocked — see 9c** |
| 9 | no notification for `(s, item)` within `W_s` days | `already_said` |

Every "no" carries a reason, because a producer that emitted nothing and said nothing is
indistinguishable from one that never ran — `market-signal.ts`'s own rule, and the
absence-reported-as-health fault the repo has fifteen measured instances of.

### 9b. The thresholds are per-series and derived, and here is the measurement that forces it

`market-signal.ts` uses one global constant (`DEFAULT_DROP_THRESHOLD = 0.1`, overridable by
one env var) and says openly that it is a chosen default. **Copying that shape here would be
wrong by a factor of eight, and this was measured today.**

The rule above was run over three real series, pulled today, with `K = 12` and a 35 percent
step guard. Command, run from `/tmp` against the BLS v1 API and the FAO CSV recorded in the
fetch log:

| Series | Observations | Rise ≥ 10% | ≥ 15% | ≥ 20% | ≥ 30% |
|---|---|---|---|---|---|
| BLS `APU0000708111` — eggs, grade A large, per doz., US city average | 126 monthly, 2016-01 to 2026-07 | 49 fires, **43.4 % of months** | 39, **34.5 %** | 34, 30.1 % | 22, 19.5 % |
| BLS `WPU017107` — PPI, eggs for fresh use | 127 monthly, same span | 40, **35.1 %** | 36, 31.6 % | 31, 27.2 % | 28, 24.6 % |
| FAO Food Price Index, all items | 440 monthly, 1990-01 to 2026-08 | 63, 14.8 % | 38, **8.9 %** | 27, 6.3 % | 9, 2.1 % |

**On the founder's own commodity, a 15 percent rise threshold fires in more than a third of
all months.** There is no global percentage that is simultaneously sensible for eggs and for
a world food index.

So the threshold is not set as a percentage at all. **The operator sets a budget — how often
this house wants to hear about this series — and the code derives the percentage from the
series' own measured history**, at the quantile that produces that rate, and stores it on the
series row with the window it was computed over. Measured today:

| Series | for ~4 fires a year | for ~2 a year | for ~1 a year | step guard: p99 of month-on-month |
|---|---|---|---|---|
| BLS `APU0000708111` retail eggs | **17.6 %** | **35.7 %** | 57.2 % | 23.2 % |
| BLS `WPU017107` wholesale eggs | **31.8 %** | **67.8 %** | 104.6 % | **82.0 %** |
| FAO Food Price Index | **3.7 %** | **8.5 %** | 15.4 % | 7.8 % |

Two things fall out of that table and both change the design.

- **The "twice a year" threshold ranges from 8.5 % to 67.8 % across three series** — a factor
  of eight. A single `COMMODITY_SIGNAL_RISE_PCT` would be a number that means eight different
  things.
- **The step guard must be per-series too.** A global 35 percent "probably a bad parse"
  ceiling — the shape `IMPLAUSIBLE_DROP_CEILING = 0.6` takes — **refused 25 of 114 evaluated
  months on the wholesale egg series**, whose p99 month-on-month move is 82 percent. Twenty-two
  percent of a real market would have been suppressed as implausible. So `J_s` is the series'
  own p99, stored with its window, and a move above it is refused **and named**, never dropped.

A series with fewer than 36 admitted observations gets no threshold at all, `rise_threshold`
stays NULL, and the rule cannot fire for it. That is stated on the screen, not left as a
silence.

**One thing this measurement does not cover, stated rather than discovered later.** All three
series are **monthly**. The USDA shell-egg index is **daily**, and a daily series' move
distribution is not a monthly one's. Its threshold must be calibrated on daily history, and
the only route to that history is the MARS API, which is unverified. Until then the shell-egg
series would be admitted to the register and **not armed for alerting**.

### 9c. The storability clause has no input today, and that is a blocker

Condition 8 requires knowing how long the house can hold the item. **Measured on this tree:
`grep -rn -i "shelf_life\|shelf life\|expiry_date\|best_before" supabase/migrations/` returns
zero shelf-life columns across every migration** — the `expires_at` hits are seals, OAuth
tokens, invites and certifications, none of them a food shelf life. This independently
confirms the calendar ADR's own finding of "no shelf-life column anywhere in 89 migrations".

Without it, *"stock up"* on the founder's own example is advice to buy three months of a
perishable. **Phase 1 may not ship condition 8 as a guess.** Three ways out, and the choice is
Q3 below: add `shelf_life_days` to the house item inside ADR 0115's phase 2; restrict the rule
to items a person has typed a shelf life for; or restrict it to `kind` values known to be
shelf-stable — which needs ADR 0115's `kind` column, also unapplied.

### 9d. The false-alarm rate: what can be stated and what cannot

**What can be stated, and must be, on the screen:** the firing rate. The sentence carries the
budget the house chose and the threshold it produced — *"you asked to hear about this series
about twice a year; that is a rise of 36 percent above its twelve-month median, computed over
113 months to 2026-07"*. That is measured, traceable and honest.

**What cannot be stated, and must be said to be unstatable:** the hit rate — how often a fire
is followed by this house's own invoice price actually rising. That needs a denominator of
fires and a numerator of confirmed invoice rises, and **both are zero today**:
`vendor_price_observations` and `price_history` each hold **0 rows in production** (measured
2026-09-04, recorded in `price-sources.md`'s class-A table: **0 rows in production** on both
own-paper rows), and no exposure exists. The plan's answer
is not to invent one. It is to record, on every fire, the series value, the threshold, the
exposure and the item — so that when class A fills, the hit rate becomes a measurement
somebody can run rather than a claim somebody has to make. **Until then the assistant states
the firing rate and is silent about accuracy**, which is exactly the line
[ADR 0083](../decisions/0083-a-page-may-not-claim-a-write-it-never-makes.md) draws for a
saving it cannot show.

### 9e. The sentence, and the seal

Two forms, chosen by `pass_through_basis`. With it `unset` — the common case — the money
clause is simply absent:

> Shell eggs, national wholesale, are 36 percent above their twelve-month median: 48.0 cents
> a dozen against a median of 35.3. USDA Agricultural Marketing Service, Daily National Shell
> Egg Index Report, issued 4 September 2026, graded loose, white, Large, FOB, 30-dozen cases.
> You mapped this series to *Eggs, large, 15-dozen case* and you carry 9 days of it. This
> house has never measured how much of a wholesale move reaches your invoice, so no figure
> for that is given. You asked to hear about this series about twice a year.

Every element is required: the series, the issuer, the issue date, the unit, the trade level,
the working, the item, the coverage, and the plain statement of what is not known.

**The action is a draft and only a draft.** It opens the existing one-tap order draft with the
item and a quantity the manager sets. Nothing is sent, nothing is approved, nothing is sealed
without `HoldToApprove`. A commodity signal is the weakest evidence in the building and it
may never be the thing that moves money on its own.

### 9f. Is it profitable? Measured, and the answer decided the cadence

The founder asked the quant question directly on 2026-09-05: *"deploy (opus) to be quant
agent, and understand how can it be profitable? maybe once in a week, 2 weeks...?"* The pass
is `cadence-value.ts` and its 32 tests; the full working is `p4-scratch/p4bf-quant-cadence.md`.
**Zero outbound requests** — every series was already recorded by phase 0 and its sha256
re-verified before the run (`p4bf-fetch-log.md`).

**What was measured.** Seven recorded monthly histories: the FAO Food Price Index and its
five sub-indices (440 rows each, 1990-01 to 2026-08) and ONS `D7BU` (463 rows, 1988-01 to
2026-07). **No egg series**: the human download the fixture contract asks for has still not
landed, so every number here is an index number and none of them is money.

**The cadence that was asked for does not exist.** These series publish monthly.

| asked for | verdict | why |
|---|---|---|
| weekly (52/yr) | **refused** `finer_than_the_series_publishes` | the series speaks 12 times a year |
| fortnightly (26/yr) | **refused** same | same |
| monthly (12/yr) | **refused** `no_threshold` on FAO | at 12 fires on 12 chances the quantile lands on the smallest move the series ever made, which is a fall |

On ONS the monthly cadence does derive — a 0.25 % threshold, 15 fires in 20 evaluable months,
**lift −0.23 pp**. Not a refusal; worse than one.

**The rule carries information, out of sample.** Threshold derived at each observation from
the observations strictly before it, K = 12, three months of cover:

| | fires / evaluable | hit rate | mean 3-month rise after a fire | benchmark (any month) | lift |
|---|---|---|---|---|---|
| FAO headline, quarterly | 135 / 401 | **66.7 %** | 4.81 % | 1.40 % | **+3.41 pp** |
| FAO headline, twice a year | 76 / 401 | 65.8 % | 5.77 % | 1.40 % | +4.37 pp |
| pooled, all seven, quarterly | 923 / 2,768 | 64.5 % | 5.65 % | 1.77 % | **+3.88 pp** |
| FAO Meat, once a year | 54 / 401 | 53.7 % | 0.16 % | 1.06 % | **−0.90 pp** |

**So §11's fear is half wrong** — it predicts something — **and half right**: on Meat the lift
is negative at the cadence a house would most likely pick, which is why arming stays
per-series.

**And the money dies on two numbers nobody had measured.** Buying `H` periods of cover costs
`c · H(H+1)/2` — triangular, because the units bought for the third month sit for three — and
the pass-through multiplies the BENEFIT and never the COST. Break-even carrying cost, φ = 1:

| series | H = 1 | H = 3 | H = 6 |
|---|---|---|---|
| FAO Food Price Index | 1.29 % | **0.96 %** | 0.84 % |
| FAO Dairy | 1.71 % | **1.66 %** | 1.57 % |
| FAO Meat | 0.53 % | **0.27 %** | 0.10 % |
| ONS D7BU | 0.58 % | **0.60 %** | 0.62 % |

At the pass-through USDA ERS measured for anything processed (16-53 %, §5b), **every fire
loses money at any carrying cost above a quarter of a percent a month.** This is §5e made
arithmetical: the alert is for goods whose published series IS the price the house pays.

**Which cadence.** Net per year, FAO headline, H = 3, 1,000 a month of spend, 8 an
interruption — every figure a stated parameter:

| φ | carry /month | quarterly | twice a year | once a year |
|---|---|---|---|---|
| 1.0 | 0.25 % | **+101.3** | +78.9 | +63.9 |
| 1.0 | 0.50 % | +40.7 | **+44.8** | +39.7 |
| 1.0 | 0.75 % | −19.9 | +10.7 | **+15.4** |
| 1.0 | 1.00 % | −80.4 | −23.4 | **−8.8** |
| 0.5 | 0.50 % | −56.4 | −20.8 | **−10.9** |

Quarterly wins one corner and collapses fastest; once a year is the most robust and leaves
value unclaimed; **twice a year is never the worst and is within a small margin of the best
almost everywhere.** That is the founder's answer, and the table is why.

**A tenth condition the nine do not have: item size.** At 8 an interruption, the smallest
monthly spend that repays being told is 168-450 on the friendliest parameters and runs into
the thousands on realistic ones. The nine conditions in §9a all ask about the SERIES; none can
see that a line is too small to be worth a sentence. `valueBacktest` names it
`below_spend_floor` and the alert prints the floor as the reason.

~~**Open: is the tenth condition ARMED — does the rule refuse to fire for an item below the
floor — or is the floor only printed?**~~ **ANSWERED AND CLOSED by the founder, 2026-09-06
(batch 61).** His words, verbatim: *"Printed state only, until the egg backtest."* So the
floor stays a printed state and never a gate: `valueBacktest` returns `withheld:
"below_spend_floor"` and `moneyState()` returns `too_small`, the sentence names the measured
floor, and nothing is suppressed by it. The condition is not armed until a backtest on a
series that IS money — the USDA shell-egg download of §10 — can say what the floor costs in
missed fires rather than in index points. **No code changed for this answer**; the built
behaviour already was the answer, and this paragraph is the record that it is now decided
rather than merely implemented.

**The strongest thing against all of it, measured on this repository's own fixture.** Run the
identical rule on the committed 40-month window (2023-05 to 2026-08) and the sign flips at
every cadence: quarterly **−0.79 pp**, twice a year **−2.74 pp**, once a year **−4.42 pp** with
a **0 % hit rate**. Thirty-six years say it beats a coin; three and a half say it does not.
The 36-year table is the evidence and the 40-month window is the world the house lives in, and
nothing further that could be measured settles which is the future.

### 9g. The egg series on one report

**A one-point series admits no walk-forward and no hit rate, and this one is a single
point.** The register holds ONE report of AMS 2843 (2026-09-04, 23 rows, 9,115 bytes, sha256
`0371c7c7…23d49c`) and `THRESHOLD_HISTORY_FLOOR = 36` refuses a threshold below 36
observations — so no threshold, no fire, no hit rate, no benchmark and no comparison between
the six cadences, and a hit rate here would have a denominator of one. Two things ARE computable and
both come out the same way (measured 2026-09-06 by `node p4-scratch/p4bo-run.js`; long form
`p4-scratch/p4bo-egg-backtest.md`; every parameter labelled; **USD, cents per dozen, on one
report**). **The whole money history is 47 price cells**: 15 current, 15 `Previous`, 17 `Last
Year`, 9 rows with all three. The series row — the six-part tuple, matched once — is **35.28**,
previous **36.14**, year ago **215.53**, volume 33,234 cases; and the two lagged columns are
**undated by the file** (all four date columns read 09/04/2026), a second reason not to write
them as observations.

**Break-even carrying cost** `c* = gross / (H(H+1)/2)`; only H = 1 is observable at all:

| Move | Gross | `c*` at H = 1 |
|---|---|---|
| series row vs `Previous` | **-2.3796 %** | **refused `not_a_rise`** — loses at a carry of zero |
| series row vs `Last Year` | **-83.6310 %** | **refused `not_a_rise`** |
| mean of all 15 rows | **-0.1985 %** | **refused `not_a_rise`** |
| the file's one big riser (cage-free national FOB) | **+10.2692 %** | 10.2692 % a period |

Three of 15 markets rose, five fell, seven did not move; year-on-year **nine of nine fell**
(mean **-70.29 %**). At **8 USD an interruption** and a carrying cost of 0.5 %/month (both
parameters; nobody has typed a carrying cost), weekly spends of **200 / 1,000 / 5,000 USD**
give a reading cost of **4.00 / 0.80 / 0.16 %** of that week's spend and a break-even move of
**4.12 / 0.92 / 0.28 %**, which **1 / 3 / 3** of the file's 15 markets beat. On the series
row's own move the floor is **never** — the net is negative, so no spend repays a reading,
which is not `below_spend_floor` (too small a line) and must not print as it.

**What N reports each cadence costs**, at the FAO pass's standard — walk-forward, K = 12,
floor 36, F out-of-sample fires, `N = 36 + F x observations-a-year / cadence + H`; F = 135 is
that pass's own quarterly fire count (standard error 4.1 pp), F = 30 the weakest bar anyone
would defend. Reports / years, recording weekly then every publication day (250 a year, a
parameter — one report cannot show its own calendar):

| Cadence | weekly, F=135 | weekly, F=30 | daily, F=135 | daily, F=30 |
|---|---|---|---|---|
| weekly | **refused** | **refused** | 691 / 2.8 | 186 / 0.7 |
| fortnightly | 307 / 5.9 | **97 / 1.9** | 1,340 / 5.4 | 330 / 1.3 |
| monthly | 622 / 12.0 | 167 / 3.2 | 2,854 / 11.4 | 666 / 2.7 |
| quarterly | 1,792 / 34.5 | 427 / 8.2 | 8,479 / 33.9 | 1,916 / 7.7 |
| twice a year | **3,547 / 68.2** | 817 / 15.7 | 16,916 / 67.7 | 3,791 / 15.2 |
| once a year | 7,057 / 135.7 | 1,597 / 30.7 | 33,791 / 135.2 | 7,541 / 30.2 |

**Recording five times as often buys five times the downloads and the same wall clock** —
fires a year is fires a year; daily recording buys one thing only, that the weekly cadence
stops being untestable. The archive is the escape (307 past reports are 307 downloads, not six
years) but under `upload_only` each is a person in a browser.

**The strongest case against reading anything into this.** Eggs are the series §5e was
written for and the moves are large, so a one-report reading that had landed on a rising day
would print a 100 % hit rate, an enormous gross and a break-even carry above anything a house
would type. **This one fell.** A verdict that depends on which day the person downloaded is
not a verdict — which is why nothing here arms anything and the spend floor stays the printed
state batch 61 decided. Also measured: **eight of the 23 rows carry no `Wtd Avg Price`, not six**;
six counts only the 19 `Graded Loose` rows. New code: `cadence-sample-size.ts`, pure, 21 tests.

**The founder, 2026-09-06, batch 63, on this section's questions.** How more reports get recorded: **"A person records 40 going forward, one at a time"** — one report per download, each a logged one-off read under the batch-57 rule, until the 36-observation floor clears and the series can be armed; no archive batch, no letter to USDA for MARS access, no cadence promised. A year of cover for eggs: **"Price it; revisit at 40 reports"** — no rule is built on one report's nine year-on-year cells; the typed carrying cost already prices long cover and the sentence prints the figure. The spend floor stays the printed state batch 61 decided. Nothing in the code changes for either answer.

---

---

## 10. Phasing

### Phase 0 — the register, no alert

The two tables of §7, RLS-locked with in-file assertions, plus the exposure table of §8 and a
read endpoint. **Two armed sources, and they are the two that pass this repo's own politeness
rules rather than the two that would be most useful:**

- **FAO Food Price Index.** `robots.txt` read and permissive, no crawl-delay declared, CSV,
  keyless, monthly, dated, and it serves **every** house rather than one jurisdiction. Its
  licence is **unstated** and is recorded as unstated, so under §3a it may be fetched and its
  display is Q4 below.
- **ONS `d7bu`.** OGL v3.0, keyless, per-observation `updateDate`, `robots.txt` 404 and
  therefore unrestricted. Serves the one UK house and sits beside the Defra produce line
  another builder shipped on 2026-09-05.

**A THIRD ARMED SOURCE, added 2026-09-05 on the founder's batch-58 decision.**
**TÜİK `DF_TUFE_SDMX_TT01`** — Türkiye's CPI for food and non-alcoholic beverages, monthly,
base 2025=100, read over the publisher's own documented SDMX service with a key the founder
minted himself. It is unlike the first two in one way that had to be built for rather than
noted: it is the first source here that needs a **credential**, so the register gained
columns for that fact (`access_key_required`, `key_env_var`, `robots_reading`, `user_agent`,
`request_budget_per_day`, `licence_url`) and the reader gained a token holder that never logs
the key or the token. **TT09** is registered beside it at a lower fetch cadence — 28 days,
because its unbounded payload measured 7,532,768 bytes — and its beverage subclasses land as
**codes**, because their labels have never been read.

**Two sources handled by the Michigan path instead of a fetcher**, because their hosts refuse
to state their crawl rules: the **USDA AMS shell-egg index** (`www.ams.usda.gov/robots.txt` is
403) gets a parser written against a real recorded fixture plus an upload endpoint — a
person's own download, dry run by default, staleness gate before every write, the person and
the file's sha256 on every row, exactly as `POST /price-index/upload` already does for the
Michigan price book. **BLS is now permitted and is deliberately still not armed in phase
0** — see the phase-1 note below. **Phase 0's armed pair stays FAO + ONS**, unchanged by
the founder's Q1 answer, so a builder already underway on phase 0 is unaffected.

Also in phase 0, and cheap: **the exposure mapping for the top N house items by spend**, typed
by a person; and **the threshold calibration job** of §9b, which needs only the series.

**What phase 0 proves:** that a series can be admitted, dated, staleness-gated, calibrated and
shown as its own labelled line without ever touching a vendor quote. **What it costs:** one
migration, two parsers, one calibration job, no licence, no key, no money.

**And one trap it must be built against, found today.** The FAO CSV has two live paths. The
current one — `/media/docs/worldfoodsituationlibraries/default-document-library/` — returns
48,006 bytes on base **2014-2016=100** ending `2026-08`. The older one —
`/fileadmin/templates/worldfood/Reports_and_docs/` — **also returns HTTP 200**, well-formed,
14,225 bytes, on base **2002-2004=100**, and **its last row is `Mar-18`**. Neither path is
disallowed by robots. A fetcher pointed at the second would get clean 200s forever and serve
data eight and a half years old on a different base. This is the `bh_fv020.txt` case and the
ONS discontinued-RPI case a third time, and it is why the staleness gate reads the **newest
observation's own period**, never the HTTP status and never the file's presence. **It is also
why the rebasing case matters:** the same index on two bases differs by roughly fifty percent,
which a step guard would read as a crash. A base change is a new series, not a new
observation.

#### Phase 0 — BUILT, 2026-09-05, on the founder's *"both: the line now, the alert behind a flag"*

The founder answered §11's fork with **both**, so phase 0 shipped the context line and phase
1's rule was built **dark** alongside it rather than deferred. What follows is what was
actually built and what was measured while building it; the four corrections this pass makes
to this document's own numbers are marked **CORRECTION**.

**Built.** One migration, `20260905235000_an_index_series_is_not_a_price.sql`, creating
`commodity_index_series`, `commodity_index_observations` and `house_item_commodity_exposure`
as §7-§8 describe them — RLS on, `anon`/`authenticated` revoked in the same file, every FK
inside `public`, and an in-file `DO` block that **probes five CHECKs by inserting and
observing the refusal** rather than trusting that they were created. Proven on PGlite
(Docker is down) by `p4-scratch/pglite-probe/p4bb-commodity-register.mjs`: applied twice
(idempotent), RLS true on all three, **0 anon/authenticated grants**, all six FKs in
`public`, and the real FAO / ONS / USDA rows admitted while a currency on an index number, a
price with no currency, an armed series with no threshold, a second live exposure for one
triple, a pass-through above 1 and a retirement with no reason were each refused by name.

The gateway module is `apps/api-gateway/src/commodity/` — registry, two parsers, a
three-gate admission, a fetch service behind `COMMODITY_INDEX_FETCH_ENABLED` (off), a read
service, `GET /commodity-index/status` and `GET /commodity-index/me`. The web draws it inside
the existing labelled index box (`MarketIndexPanel.tsx` + `useHouseCommodity.ts`), extending
that register rather than opening a fourth box.

**CORRECTION 1 — the shell-egg parser was NOT built, and deliberately.** This section says
the USDA AMS index "gets a parser written against a real recorded fixture". Writing one
requires bytes from a host whose `robots.txt` returns 403, and §3c's own rule — *no scheduled
fetcher may be pointed at that host* — was read here as also barring the one-off read that
would have produced the fixture. **This task did not contact `www.ams.usda.gov` at all.** The
series is registered with `admission = 'upload_only'`, the 403 as its `withheld_reason` and
`armed = false`, and the panel names the 403. The parser and the upload wiring are owed, and
whether a one-off read for a fixture is permitted where a fetcher is not is founder question
Q7 below.

**CORRECTION 2 — the FAO CSV states no date at all**, which this document does not say and
which decides a column. Measured on the fetched bytes: line 1 is the title, line 2 the base,
line 3 the header, and there is no release date, revision date or "generated on" line
anywhere. So FAO is `issued_at_basis = 'fetch_date'` and its line reads **"read on"**, while
ONS — which stamps a series `releaseDate` AND a per-observation `updateDate` — reads
**"issued"**. Two series, two words, both measured, both pinned by tests.

**CORRECTION 3 — §9b's step guard for FAO is 7.8 % by nearest rank, not by interpolation.**
Re-measured through the shipped code on the full 440-row series: an interpolated p99 is
**7.49 %**, which lies BETWEEN two real observed steps (6.98 % and 7.80 %) and would refuse a
7.80 % month the market printed. The implementation therefore uses **nearest rank** for the
guard — landing on 7.80 %, this document's own figure — and keeps interpolation for the rise
threshold, which is what lands on the budget. The asymmetry is documented at
`quantileCeilingRank`.

**CONFIRMATION — §9b's FAO row reproduces exactly.** Different code, re-fetched bytes, same
answers: **3.7 % / 8.5 % / 15.4 %** for four, two and one fire a year, and **63 / 38 / 27 / 9**
fires at flat thresholds of 10 / 15 / 20 / 30 %. The re-fetched CSV's sha256 is also
byte-identical to the one recorded here.

**CORRECTION 4 — the threshold calibration job is NOT built as a job.** The arithmetic is
shipped and tested (`deriveThreshold`, `quantileCeilingRank`, `movesOverHistory`), and nothing
schedules it or writes `rise_threshold` to a row. No series is armed today, and the migration's
CHECK refuses arming one without a derived threshold, so the dark rule's honest verdict on
every house right now is `no series in the register is armed`. The job is owed.

**Also not built:** the exposure mapping for the top N house items by spend. The controller
has **no POST at all** — asserting a mapping puts a person's name on a join a rule later fires
on, and that act belongs in front of a reviewer. `noExposureRecorded` is true on every house
and the panel says so in words.

**The dark alert.** `commodity_exposure_rising` is built and **cannot reach a person**:
`CommodityModule` imports no `NotificationsModule`, so there is no service to notify with, and
a test asserts it. Behind `COMMODITY_ALERT_DARK` (off; an allow-list) it writes one
`neural_footprint_event` row per evaluation — verdict in `choice`, working in `internal_state`,
`dark: true` / `reached_a_person: false` in `context`, **`outcome` NULL always**, because
whether a fire was right needs a numerator this product does not have. **Two of the nine
conditions are not evaluated** — coverage and storability — and are named on every decision,
every ledger row and the report line, rather than skipped into looking satisfied. Q3 is
unchanged and is what unblocks them.

**Verified.** `npx jest src/commodity` — **78 passed, 6 suites**. `npx vitest run
src/pages/notifications/next` — **120 passed of 122**, the two failures in `nt-book.test.ts`,
which is byte-identical to `HEAD`. Gateway `tsc --noEmit` under both `tsconfig.json` and
`tsconfig.spec.json`: **0 errors in `src/commodity`**. Web `tsc --noEmit`: 0 errors in the
touched files. Seven guards exit 0. **`check_gateway_boots.sh` FAILS on this tree and the
cause is not this work**: `dist/price-index/price-index.module.js`, untouched here, crashes
with the same `Cannot access 'IntegrationsOauthService' before initialization` from an
untracked `communications/archive/` require cycle. So **this module's Nest DI is UNPROVEN**,
and that is stated rather than assumed.

#### Phase 0, continued — the founder's answers to Q1-Q5 and batch 51, BUILT 2026-09-05

Five questions were answered and every answer is now code. Where an answer
changed something this document asserted, it is marked **CORRECTION**.

**Q1 — a one-off HUMAN read, logged.** The USDA AMS shell-egg parser is written
(`parse-usda-shell-egg.ts`) against the format §1 and §2a recorded, plus a
fixture contract (`__fixtures__/USDA-SHELL-EGG-CONTRACT.md`) stating exactly
what the download must contain and what must be recorded beside it — who, when,
the sha256, the byte count. **This task made zero outbound requests and did not
contact `ams.usda.gov`.** The registry carries `awaitingHumanDownload: true`, the
panel says *"waiting on a person's own download"*, and `parserFor()` already
routes the series, so the day the file lands nothing else changes. A defect the
tests caught while writing it, worth recording because the same shape will
recur: a first attempt stripped price ranges with a whitespace-tolerant pattern
and read `35.28     -0.86` (weighted average, then the SIGNED change) as a
range, returning the last-reported figure instead. The parser now reads **by
column order** — the token after the range token — and two regression tests pin
it.

**Q2 — display FAO with the unstated-licence sentence.** Kept. The line reads
*"This publisher states no licence for this series. Recorded as unstated, never
as permitted."* **This settles Q4 of §12 for display and leaves the registry's
standing rule untouched**: unstated is still never upgraded to permissive, and
the sentence is what makes showing it honest rather than silent.

**Q3 — a manual admin act, sealed, with the numbers shown first.**
`GET /commodity-index/admin/series/:key/proposal` shows every budget's derived
threshold and the sentence it would produce; `POST .../arm` must carry back the
proposal's sha256, and the service **recomputes the proposal from the series'
own observations before comparing**. A threshold that moved since it was read
cannot be armed. Disarming is deliberately not hash-gated. Both are logged to
`commodity_series_arming_log`, which records the OFF direction too.

**CORRECTION — the arming act CANNOT use the tenant seal store, and this is
measured rather than a design preference.** `mcp_seal_challenges.actor_user_id`
is `UUID NOT NULL REFERENCES public.users(user_id)`
(`20260904170000_a_seal_is_redeemed_not_asserted.sql`), and ADR 0099's
`ServiceKeyGuard` says in its own words that it *"authenticates a machine; it
carries no tenant and no user"*. A Mudavym admin has neither, so the seal table
structurally cannot hold this act and minting a synthetic user row would put a
person's name on a decision they did not make. What is preserved is the seal's
load-bearing property — `args_hash`, *what was on the screen when the hold
began* — as the recomputed proposal hash. The EXPOSURE act does have a real user
and a real house, and it uses `SealChallengeService` properly, with a new
`commodity_exposure` subject kind.

**Q4 — where the judged rule lands: a producer**, beside `market-signal.ts`, not
a thirteenth rule in the recommendations engine. Recorded in
`06-pages/recommendations.md` §13. It is an interruption about a moment, not a
standing recommendation.

**Q5 — the exposure-assertion route, sealed and named.**
`POST /commodity-index/exposures/challenge` then `POST /commodity-index/exposures`,
owner/manager, the house taken from the session and never from the body. The
seal's args carry the series, the pass-through AND the lag, so an exposure held
open at *"we do not know"* cannot be spent at ninety percent. Seven distinct
refusals, each with its own sentence — including `already_asserted`, which names
the partial UNIQUE rather than reporting a broken write. Retirement names a
person and a reason and is **not** sealed: the same friction on the off
direction is how a wrong mapping stays live for another ten minutes.

**Batch 51a — shelf life comes ONLY from a person.**
`20260906071000_a_shelf_life_is_typed_by_a_person.sql` adds
`restaurant_inventory.shelf_life_days`, nullable, **no default**, with the
author and the moment enforced as one fact by a CHECK, plus an optional
`shelf_life_basis` in the person's own words. Nothing infers one from a
category. The migration asserts that it backfilled **zero** rows, and asserts
that no shelf-life column carries a DEFAULT.

**This closes §9c's blocker and shrinks the rule's unevaluated list from two to
one.** Condition 8 is now evaluated, and note the direction: a typed shelf life
can only ever REMOVE an item from the firing set. Two new refusals, deliberately
worded differently — `no_shelf_life_typed` (fixable by a person in a minute) and
`does_not_keep_long_enough` (a fact about the item). **Condition 7, coverage,
is still not evaluated and is still named on every decision and every ledger
row.**

**Batch 51b — rates ARE series, and this answers §12's Q6.** Three registered,
`value_kind: 'rate'`, each with its statute and effective date:

| Series | Unit | Instrument | In force | Denominator |
|---|---|---|---|---|
| HMRC alcohol duty (wine and spirits 8.5-22%) | GBP per litre of pure alcohol | Finance (No. 2) Act 2023, Part 2 | 2026-02-01 | `litre_of_pure_alcohol` |
| Illinois liquor gallonage tax (above 20% ABV) | USD per gallon | 235 ILCS 5/8-1 | 2026-07-01 | `gallon_of_liquid` |
| GİB ÖTV (III)(A) asgari maktu | TL, asgari maktu vergi tutarı | 4760 sayılı ÖTV Kanunu; 10799 sayılı Karar | 2025-12-31 | **`unstated`** |

**Nothing was fetched for any of them.** All three were measured on 2026-09-05
by the market-research builder with `robots.txt` read first, and are cited from
`price-sources.md` lines 269, 295, 471 and 565 rather than re-crawled.

**The per-bottle duty line is derivable, and it is not printable for anybody
today — for two measured reasons that are worth stating plainly.** `duty.ts`
implements all three denominators and is tested to the penny (HMRC 30.62/l at
750 ml and 40% = **GBP 9.19**; Illinois 8.55/gal at 750 ml = **USD 1.69**, on the
exact 3.785411784). It then refuses every real bottle, because:

1. **There is no alcohol-by-volume column anywhere in `master_wine_library`.**
   Grepped 2026-09-05 against the baseline: `ml_derived_features` and
   `bottle_size_ml`, and nothing else. HMRC's rate is per litre of PURE alcohol,
   so no UK figure can be computed for any bottle in this product.
2. **`bottle_size_ml integer DEFAULT 750 NOT NULL`.** A duty computed off that
   column would be a number nobody chose, printed as this bottle's tax — the
   `restaurants.currency DEFAULT 'USD'` defect with a figure attached. So
   `perBottleDuty` takes the size and the strength with an explicit SOURCE for
   each and refuses `column_default`.

And GİB is refused for a third reason that no amount of typing fixes: **the
issuer does not state what the figure is per.** `price-sources.md:269` records it
verbatim — press reporting of the same decision divides by 100, which implies
per litre of pure alcohol, and that was never confirmed against Law 4760. It is
registered `silent: unit_denominator_not_stated`, shown as published, and no
per-bottle line is ever derived from it. Guessing there is a tax figure wrong by
a factor of a hundred.

**A DEFECT FOUND WHILE PROVING THIS, IN ANOTHER BUILDER'S FILE.** Replaying the
seal-vocabulary chain on PGlite in prefix order — which is what a fresh
`db reset` does — measured: `20260905225000` READS the existing kinds and appends
`text_credit_purchase` (6 kinds), and then `20260905233000` rewrites the CHECK
**from a hard-coded six-kind literal** and drops it again (6 kinds, without it).
`SEAL_SUBJECT_KINDS` in the code declares `text_credit_purchase`, so **the
database refuses a kind the code uses** — the guaranteed production failure
`20260904210000`'s own comment warns about. Not fixed here: it is another
builder's file and outside these paths. This migration uses the read-and-append
shape, so `commodity_exposure` cannot be dropped by ordering and cannot drop a
peer's kind.

**Verified.** `npx jest src/commodity` — **160 passed, 11 suites**. `npx vitest
run src/pages/notifications/next` — **135 passed, 7 suites, 0 failed**. Gateway
`tsc --noEmit -p tsconfig.json`: **0 errors**; `-p tsconfig.spec.json`: 0 in
`src/commodity`. Web `tsc --noEmit`: 0 errors. Twelve guards exit 0 (the builder wrote "ten"; the parent counted twelve on the archive of 077636a2 and the audit abeee63f978b547f0 confirmed twelve). Both migrations
applied twice on PGlite (idempotent), RLS on, anon/authenticated 0, every FK
inside `public`, and the CHECK probes refused: arming with no actor, arming on a
proposal hash that is not a hash, logging an arming with no numbers, an invented
act, a shelf life with nobody's name on it, an author with no value, zero days,
and clearing only half the fact.

#### Phase 0, continued — the founder's batch-57 answers, BUILT 2026-09-05

**"Add ABV to the library, nullable, no default."**
`20260906120000_a_strength_is_stated_by_a_person.sql` adds
`master_wine_library.abv_percent numeric(4,1)`, nullable, **no default**, with
`abv_percent_set_by` / `abv_percent_set_at` enforced as one fact by a CHECK and
an optional `abv_percent_basis` in the person's own words. Range
`0 <= abv <= 100`, and the ceiling earns its place: a transcription that reads a
US *proof* figure as a percentage doubles it, so 151 proof becomes 151 and is
refused at the door.

**Why the library's author pattern is the same as a house table's, and why it
matters MORE here.** `restaurant_inventory.shelf_life_days` carries its author
because a shelf life nobody typed would mislead the house that typed it.
`master_wine_library` is **shared**: every house that stocks the bottle reads
this row, and the value is the multiplicand in a **tax** figure. A wrong ABV does
not merely mislead one kitchen; it produces a number that looks like a duty and
is not one. The library's existing `beverage_identities.curated_by` /
`curated_at` confirm the shape rather than contradict it — this is the same
discipline applied to a field rather than to a promotion.

**The house alias never touches it, and that is asserted rather than intended.**
A house's own bottle is a `beverage_identities` row with
`asserted_for_restaurant_id` set. Strength is a property of the LIQUID, so it
lives on the shared row only, and the migration RAISEs if an `abv%` column ever
appears on `beverage_identities` — measured on every replay instead of
remembered. A test also asserts the resolver would not read one if it did.

**CORRECTION to this document — a stated bottle size ALREADY EXISTED, and no
new column was needed for it.** The requirement is that a duty print only on a
STATED size, "not the 750 default". `master_wine_library.bottle_size_ml` is
`integer DEFAULT 750 NOT NULL` and cannot distinguish the two — but
`beverage_identities.size_ml` already can, by its own design and its own
comment: *"NULL means unstated. NEVER 750: the library's 750 is a column default
and this register exists partly to stop that default being read as a fact"*
(20260905140000). So `bottle-facts.ts` reads the size off the identity register
and the strength off the library, and **`bottle_size_ml` is read by nothing in
this path**. Adding a second stated size to the library would have been a second
answer to a question ADR 0124 already answered.

**Which identity, when a library row names several.** A wine sold in 750 ml and
in magnum is two trade items and one library entry. So: this house's own
identity if exactly one states a size; else a platform-wide one if exactly one;
else **refused as `size_ambiguous` and named**. Picking the first would compute
a magnum's tax for a 750 — off by a factor of two and entirely ordinary-looking
on a screen, the same failure the shell-egg parser refuses as `ambiguous_row`.

**A correction to `duty.ts` the new column forced.** It previously refused
`abvPercent <= 0`, which collapses two different answers: NULL is *nobody has
stated a strength*, and **0.0 is a person stating a de-alcoholised product** —
and HMRC's own 0-1.2% band is GBP 0.00. It now refuses only NULL and negatives,
so a duty of zero prints as a figure rather than as an absence.

**The line now prints.** Where both facts are stated: HMRC 30.62/l of pure
alcohol on 750 ml at 40% = **GBP 9.19**; Illinois 8.55/gal on a house-stated
1500 ml magnum = **USD 3.39**. Where they are not, the panel prints the refusal
instead of an empty space, because *"nobody has stated this bottle's strength"*
is something a person can go and fix. The three refusals and the one print are
the tests the founder asked for (`bottle-facts.spec.ts`), plus the GİB case that
no amount of typing fixes.

**The DTO mirror, and it is now armed.** `WineResponseDto` was added to
`wines/dto/wines.dto.ts` and a third entry to `check_web_reads_gateway_dto_keys.py`'s
MIRRORS table pins the web's `Wine` against it — **21 client keys against the
DTO's 23**. Proven adversarially rather than assumed: a phantom `abvProof` added
to `Wine` made the guard exit **1** naming it, and removing it returned exit
**0**. Two keys the web declares and `mapWine` does not send (`pairingNotes`,
`imageUrl`) are declared on the DTO with a comment saying so rather than deleted
from the client type — the honest fix for an unsent field is to send it, and
that is filed rather than papered over.

**Verified.** `npx jest src/commodity` — **198 passed, 13 suites**. `npx vitest
run src/pages/notifications/next` — **140 passed, 7 suites**. Gateway `tsc` clean
under both configs; web `tsc` clean. `check_gateway_boots.sh` PASS. The migration
applied twice on PGlite on BOTH an empty library (the CI shape, where it NOTICEs
that its probes did not run) and a seeded one, with a strength-without-an-author,
a 151, a negative and a half-cleared fact each refused by name, a stated 0.0 and
an exactly-100 admitted, and `beverage_identities` measured to carry **0** ABV
columns.

**A prefix collision, and how it was handled.** This migration was first written
as `20260906110000` and another builder landed a file on that prefix between the
check and the write. Mine was moved to `20260906120000`; theirs was not touched.
`ls supabase/migrations | cut -c1-14 | sort | uniq -d` is empty.

### Phase 1 — the rule and the sentence

`commodity_exposure_rising` as §9, behind a flag defaulting off, with the storability question
answered first. Every fire records series, threshold, budget, exposure and item, so that §9d's
hit rate becomes computable later.

**BLS arms here, at the start of phase 1 — not in phase 0.** The founder's Q1 answer of
2026-09-05 permits it, and phase 1 is where it becomes *necessary*: both of phase 0's armed
sources are `value_kind = 'index_number'`, and the alert's most useful sentence needs a
series whose `value_kind` is `price` — the AP average-price family, in dollars per dozen, is
the only free one measured anywhere in this plan. Arming it is four things, none of them
code: a person **registers a v2 key** (500/day, 50 series, 20 years, 50 requests per 10 s);
the fetcher sends **an honest User-Agent with a contact URL**; a `daily_request_budget` is
set and counted against so the limit is respected by construction rather than by care; and
the source row carries **both** the robots reading — `disallow_all`, its read time and its
sha256 — **and** the terms relied on, by URL and read date. **The terms URL is the open item:
`bls.gov/bls/termsofservice.htm` returned 404 on 2026-09-05, so the real terms document must
be located and read before the row can honestly name one.** Until then `terms_url` would
point at `api_faqs.htm`, which publishes limits but is not a terms of service.

**What it proves:** whether a house acts on a commodity signal at all. **What it costs:** the
rule, the producer, the sentence and the panel, plus one key registration. **What it is
blocked on:** Q3, and the BLS terms document above.

### Phase 2 — licensed data, and only if phase 1 earns it

The trigger to open this is **not** "the free series are slow". It is a measured statement
that a specific house's invoice price for a specific item moved with a specific series and
that the free series' cadence was the binding constraint. Until that measurement exists,
paying for a futures feed buys a number nobody can show is load-bearing — and §5d says the
Federal Reserve could not find the effect at all for row crops with futures prices in the
model. **The precondition is a measurement, not a budget.**

---

## 11. The strongest counter-argument

**This whole plan may be building an instrument that fires constantly and predicts nothing,
and two of its own measurements say so.**

The Kansas City Fed, with a drought instrument, a structural VAR and futures prices included,
could not find a precise pass-through from row crops to food prices at all, and put the
horizon at about a year when it found one. And the firing table in §9b says that on the
founder's own commodity a plausible-looking threshold fires in a third of all months. Put
together: the class of alert most likely to be *right* is the one about a commodity so
unprocessed that its wholesale price is the invoice price — and for exactly those commodities
the series is so volatile that any threshold either fires constantly or fires only after the
move has already happened. **A signal that is either noise or history is not a signal.** The
per-series budget calibration does not fix that; it only makes the frequency a choice rather
than an accident.

The honest weaker version, and it is genuinely useful: **drop the word "beforehand" and build
a context line instead of an alert.** When a manager opens an order for eggs, show the series
beside it — its level, its move against its own median, its issuer and its date — and let the
person decide. That invents nothing, needs no threshold, needs no calibration, has no
false-alarm rate because it makes no claim, and reuses the labelled-index-line panel that
already exists on `/notifications`. It gives up the interruption, which is the part the
founder actually asked for.

**Against that, the case for building the alert anyway**: the context line is invisible to a
manager who is not already opening an order for eggs, and the whole point is the house that
does not know to look. The interruption is the product. But it only earns its place if the
frequency is chosen by the house and the sentence says what it does not know — which is why
§9b and §9d are the load-bearing parts of this plan and the arithmetic is not.

**This is a genuine fork and it is the founder's.** It is Q2.

---

## 12. Founder-only questions

Numbered for this document. **Q1 was answered by the founder on 2026-09-05 and is struck
through below rather than removed; the other five are open.**

1. ~~**Does `Disallow: /` on a documented, key-issuing API host bar our fetcher?**~~
   **ANSWERED AND CLOSED by the founder, 2026-09-05.** The question was whether
   `api.bls.gov/robots.txt` — **200**, 26 bytes, `User-agent: * / Disallow: /` — closes a
   host whose owner documents an API, publishes its limits and issues keys for it. The
   founder's words: **"Register a key, use the API under its terms."** The reasoning
   recorded with it: **the API's terms are the specific permission and the robots file the
   general one.** So Mudavym registers a **v2** key, sends an honest User-Agent with a
   contact, stays under the daily limit, and **records both the robots reading (with its
   time and its hash) and the terms it relies on in the source row** — the columns are in
   §7a, the arming step is in §10's phase 1, and the shape of a row admitted *against* a
   `Disallow: /` is `robots_verdict = 'disallow_all'` beside a named `terms_url`, so the
   decision is visible on the row rather than buried in this document.
   **Two paths rejected**: honour robots and take only the `download.bls.gov` flat files —
   measured 2026-09-05, that host's own `robots.txt` returns **404**, and the flat files are
   a different product with a different cadence; and hold BLS entirely, which would leave
   this plan with no free price series in dollars at all, only index numbers.
   **This sets a rule for every future API**, not just this one.
   **The record of how I got here is kept rather than tidied away:** I made thirteen or
   fourteen data requests to that host *before* reading its robots.txt, and I then omitted
   that robots read from the fetch log; both are corrected in §3c and in the log's
   §"Correction", and the re-read at 14:12Z was byte-identical. The founder's answer makes
   the requests permissible in hindsight; it does not make the order or the omission
   correct, and neither is deleted.
   **One item this answer opens rather than closes:** the terms it tells us to rely on are
   **unread** — `bls.gov/bls/termsofservice.htm` returned **404** on 2026-09-05. Locating
   and reading the real terms document is a precondition of arming, recorded in §10.
2. **The alert, or the context line?** §11. An interruption that fires on a threshold, or a
   labelled series shown beside the order for that item with no claim attached. The evidence
   in §5d is genuinely uncomfortable for the first, and the second gives up the thing you
   asked for.
3. **Where does shelf life come from?** Measured: no migration in this repo has a shelf-life
   column. Without one, condition 8 cannot be evaluated and *"stock up"* on eggs is bad
   advice. Add `shelf_life_days` to the house item inside ADR 0115's phase 2, restrict the
   rule to items a person has typed one for, or hold phase 1 until ADR 0115 is applied?
4. **A series whose licence is `unstated` — fetch it, show it, or neither?** FAO declares no
   licence at all, and FAO is phase 0's best source because it serves every house. The
   registry's standing rule is that unstated terms are recorded as unstated and never as
   permissive, but it has never had to decide whether "unstated" blocks *display*. AHDB is the
   settled `prohibited` case; this is the unsettled one.
5. ~~**How often do you want to hear about a series?**~~
   **ANSWERED AND CLOSED by the founder, 2026-09-05, batch 59.** The question was which of
   three budgets — four times a year, twice, or once — the register should propose. The
   founder's words: **"Twice a year, and the house types its carrying cost."** Both halves
   are now code. `DEFAULT_BUDGET = 2` in `commodity-calibration.ts`, marked on the proposal
   the admin reads before arming, with the rejected budgets carrying their reasons beside
   them (`BUDGET_RATIONALE`) rather than disappearing; and
   `restaurants.carrying_cost_percent_per_month`
   (`20260906140000_a_carrying_cost_is_typed_by_a_person.sql`), nullable, no default,
   author and moment enforced as one fact, with its own settings register at
   `/settings?tab=carrying-cost`.
   **The evidence is §9f below, and it is what makes both halves one answer**: the alert
   does carry information, and its whole gain is spent by a carrying cost of about one
   percent a month — so the frequency was never separable from the cost of acting on it.
   **The cadence that was asked for and does not exist is named rather than left absent**:
   weekly and fortnightly are refused by `backtestCadence` as
   `finer_than_the_series_publishes`, because FAO and ONS publish monthly and a rule cannot
   speak more often than its series does (`CADENCE_NOT_ON_OFFER`).
   **One thing this answer opens rather than closes**: the six questions the quant pass
   raised are carried into ADR 0117's class-E notes, and the first two — will a house type
   a carrying cost at all, and do we act on 36 years or on 40 months — are still the
   founder's.
6. **Is a rate a series?** HMRC duty, the GİB ÖTV schedule and the Illinois gallonage tax all
   fit `value_kind = 'rate'` cleanly, and they are exact, dated, unit-stamped and openly
   licensed — better provenance than most prices here. Putting them in this table would give
   the three non-US houses something real. It is also the second half of `price-sources.md`'s
   Q9 (the derived per-bottle duty line), which is still open, and this table would make that
   easier to build without deciding it.

#### Phase 0, continued — TÜİK, and Q22 CLOSED (the founder's batch 58, 2026-09-05)

**The founder's words:** he minted a personal API key in TÜİK's Veri Portalı —
*institutional credentials later* — put it in the repo root `.env` as
`TUIK_SDMX_API_KEY`, said *"act safely and healthy, and check if it works"*, and
on the dataflow question chose *"TT09 as well, codes unnamed for now"*.

**It works, and the check is logged.** The parent, once: a POST to
`giris.tuik.gov.tr/realms/web/protocol/openid-connect/token` (client
`nsi-ws-consumer`, `grant_type=password`) answered a bearer token with
`expires_in` **300**; the CPI food key then answered **HTTP 200, 891 bytes**,
8 monthly rows, **2026-08 = 134.31**, base 2025=100. The whole response is the
fixture (`__fixtures__/tuik-tt01-cpi-food-2026-09-05.sample.csv`, sha256
`5760a5fa…72a2d9`), unreduced, and a test asserts that hash so the parser can
never be proved against something nobody fetched. **This builder made zero
outbound requests.**

**ADR 0117 Q22 is CLOSED.** Türkiye was `silent: no_machine_endpoint` in the
price register and had no index line at all. It now has a documented, dated,
base-stamped monthly series on the publisher's own supported route, and a
Türkiye house sees four series where it saw one.

**Q23 is closed too, and it was already decided.** The separate commodity table
is where an index number lands — the founder's batch-37 call, *"a seperate table
for index series"*. TÜİK makes the case concrete rather than theoretical:
`DF_TUFE_SDMX_TT01` yields 134.31, unitless, base 2025=100, and every one of the
five columns §6 lists would refuse it.

**What "act safely" turned into, and it is five things.**

1. **The key and the token are never logged, thrown or returned.** Every failure
   path builds its sentence from a STATUS, never from a body — a rejected
   credential's response is the single most plausible place for an echoed key —
   and a scrubber strips anything JWT- or key-shaped from any message that could
   still carry one. Tests assert the absence directly, including on a thrown
   fetch error whose message contains the key.
2. **An unset variable refuses in words, naming the variable.** A missing
   credential and a broken publisher are different facts; the first is a
   DEPLOYMENT fact and the sentence says so, because the person reading it is the
   person who can fix it.
3. **The 300-second life is respected with a 30-second margin**, so a slow read
   started with a "valid" token cannot finish after it died.
4. **A request budget we impose on ourselves** — 24 a day for TT01, 2 for TT09.
   TÜİK states no rate limit anywhere, measured, and a source with no stated
   limit is where a runaway loop does its damage. The budget is checked BEFORE
   the token, so a misconfigured environment cannot spend the day's allowance
   discovering it is misconfigured.
5. **The identity is honest and reachable** — `MudavymBot/1.0` with a contact —
   and `nsiws.tuik.gov.tr/robots.txt` answering **401** is recorded as itself,
   not flattened into FAO's 200, ONS's 404 or USDA AMS's 403. The politeness
   reading differs here and is written down: this is not a crawl, it is an
   authenticated read of a documented API on a key the publisher issued.

**The two traps the researcher found, both built against.**

* **`UNIT_MEASURE` is empty on every row, and `DEGISIM` is the unit.** `1` is the
  index level, `2` a monthly percentage change, `4` an annual one. Nothing in the
  payload says so. A parser that trusted the file would put a 0.22 beside a
  134.31 and both would look like data. The axis is declared on the series and
  every other row is **refused and named**, never filtered out quietly.
* **`BASE_PER` moved and both bases are still published.** TÜİK rebased off
  2003=100 within the last year. The base is read back out of the file and
  compared with the register's — the same gate that catches FAO's older CSV path
  — and a test proves the 2003 file is refused as `base_changed`.

**The ten-dimension key order is pinned against the recorded header.** The
service's own `/structure` advertises **six** dimensions; the payload has ten.
Building a key from `/structure` produces a wrong key that still looks right, so
`KEY_DIMENSIONS` is the payload's order and a test asserts it equals the recorded
file's columns 1..10.

**TT09 stays codes.** `02110` = 128.89, `02121` = 126.50, `02130` = 140.20 at
2026-08. The codelist endpoint answers 401 and the Data Explorer view went blank
five times, so the labels have never been read; the entry is
`silent: codelist_unread`, the panel prints the sentence, and a test asserts no
renderable field on that series contains a beverage noun in any language.
Guessing that `02130` is wine would be inventing a fact about a series a house
might act on.

**Verified.** `npx jest src/commodity` — **242 passed, 15 suites**. `npx vitest
run src/pages/notifications/next` — **146 passed, 7 suites**. Gateway `tsc` clean
under both configs; web `tsc` clean. `check_gateway_boots.sh` PASS. The migration
applied twice on PGlite with six CHECK probes refused — keyed with no variable, a
pasted credential where a name belongs, a lowercase name, keyless-but-naming-one,
a zero budget and a negative one — and the real TT01 shape admitted.

**OWED, AND NOT OURS TO DO: the key must be set on the production deployment's
environment (Railway) before this series arms there.** Nothing built here sets
it, and nothing can. Until it is, `GET /commodity-index/me` on production says,
in words, *"Read over a credential this deployment does not hold: TUIK_SDMX_API_KEY
is not set here"* — which is the honest sentence and not a silence.

#### Phase 0, continued — the shell-egg file landed, and it corrected two of our own expectations (2026-09-05)

**The founder's Q1 answer executed.** *A one-off human read, logged* — the
parent read USDA AMS report 2843 through the app's Browser pane on 2026-09-05,
and the parser and its tests are now against those bytes. **No fetcher, script
or job touched the host, then or now.**

**CORRECTION to this plan's §1 and §10: it is not the PDF.**
`www.ams.usda.gov/mnreports/ams_2843.pdf` — the URL §1 records and §10 names as
the Michigan-path target — answers a browser with a **file-download dialog the
pane cannot complete**. The same report's **HTML data view** on My Market News
was read instead (`mymarketnews.ams.usda.gov/public_data?slug_id=2843`, section
*Report Detail Weighted*, Final, 2026-09-04, all 23 rows). 9,115 bytes, sha256
`0371c7c7…23d49c`, recorded whole.

**CORRECTION to the fixture contract, and the second one would have been a live
bug.**

1. **The facts are COLUMNS, not face text.** §1 quotes the PDF's
   *"Caged 30-Dozen Cases / Cents Per Dozen / FOB"* line, and the parser written
   before the bytes existed looked for exactly that in prose. In this view
   `Report Date` is a column on every row, `Price Unit` reads `Cents Per Dozen`
   on every row, and `Freight` reads `FOB` **or `Delivered` per row**. That
   parser would have refused the real file three times over.

2. **THREE rows are graded loose, white and Large.** §1 records the series as
   *"Graded loose, white, Large: weighted average 35.28"* — true, and not
   sufficient to find it:

   | Environment | Origin | Freight | Wtd Avg |
   |---|---|---|---|
   | Cage-Free | California | Delivered | **50.46** |
   | Cage-Free | National | FOB | **28.67** |
   | **Caged** | **National** | **FOB** | **35.28** |

   The contract's own `ambiguous_row` refusal would have fired on the real file
   — which is the refusal working, not failing. **Selecting on "white Large"
   alone would have taken 50.46 for 35.28: a 43 percent error, on a different
   market, that looks entirely ordinary on a screen.**

**So the parser was REPLACED rather than extended**, and the choice is stated
because it is a choice: the PDF-text shape is gone. Keeping it beside the
tabular one would mean shipping a second code path that has never seen a byte
and can never be proved — the exact shape this register refuses everywhere else.
If a PDF is ever brought, that gets a recorded fixture first and a branch
second, in that order.

**The selection is now a six-part tuple** — egg type, environment, colour,
class, origin, freight — declared on the series and matched exactly; more than
one match is `ambiguous_row`, none is `row_not_found`, and neither is resolved
by guessing. Columns are resolved BY NAME (a test reverses the header and the
parser still reads 35.28), the unit is checked per row, and **six of the 23 rows
carry an empty `Wtd Avg Price`** — refused as *"that market did not report on
this date - it is not a price of zero"*, because `Number("")` is 0.

**What the landing did NOT change, and the register says so.**
`awaitingHumanDownload` flipped to `false`, which means *the parser has seen
real bytes*. `admission` stays **`upload_only`**, the withheld reason now
carries the words *a one-off read is not a cadence*, and the series is still
**not fetchable**: `www.ams.usda.gov/robots.txt` still returns 403, the report
publishes **daily**, and this register holds one day of it. It also remains
**unarmed for alerting** for the reason §9b gives — every threshold measurement
behind this design was made on monthly series.

**Verified.** `npx jest src/commodity` — **260 passed, 15 suites**, of which 19
are this parser's, all against the recorded bytes with the sha256 asserted.
