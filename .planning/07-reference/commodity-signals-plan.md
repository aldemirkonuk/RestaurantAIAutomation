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
| **BLS Public Data API v1** | PPI and CPI series, and the **AP average-price series which are prices in dollars, not index numbers** | monthly | `https://api.bls.gov/publicAPI/v1/timeseries/data/` | yes, in the payload, including a `"Preliminary"` footnote | **the terms page named by the FAQ, `bls.gov/bls/termsofservice.htm`, returned 404 — the terms are unread and are not asserted here** | **v1: 25 queries/day, 25 series, 10 years, no key. v2: 500/day, 50 series, 20 years, free annual key. Both 50 requests / 10 s** — quoted from `bls.gov/developers/api_faqs.htm` | **yes, and then a problem.** `APU0000708111` (*Eggs, grade A, large, per doz., US city average*) returned 2026 M07 = **2.189**, M02 = 2.500. `WPU017107` (*PPI, eggs for fresh use*) and `WPU0223` both returned clean. **Then `https://api.bls.gov/robots.txt` returned 200 with `User-agent: * / Disallow: /`** — see §3c and founder question Q1 |
| **FAO Food Price Index** | A world index of food commodity prices, plus five sub-indices: cereals, vegetable oils, dairy, meat, sugar | **monthly**, on a published calendar | **CSV**, keyless: `www.fao.org/media/docs/worldfoodsituationlibraries/default-document-library/food_price_indices_data.csv` | **yes** — the page states the release date and the next one; the CSV states its own base | **no licence declared on the page.** Footer is "© FAO 2026" with a general terms link. **Unstated, recorded as unstated** | `robots.txt` **200**: `*` disallows `/index.php`, `/t3lib/`, `/typo3/`, `/*?id=*` and two `user_upload` paths. **The CSV path is permitted; no crawl-delay is declared** | **yes.** August 2026 = **133.3**, released **2026-09-04**, next **2026-10-02**. CSV: 48,006 B, sha256 `746104cf…c62f`, 444 lines, base **2014-2016=100**, last row `2026-08,133.3` |
| **ONS time series (JSON)** | UK CPI, including **`d7bu` — CPI INDEX 01: FOOD AND NON-ALCOHOLIC BEVERAGES 2015=100** | monthly | keyless per-series URL: `.../timeseries/d7bu/mm23/data` | **yes** — `releaseDate`, `nextRelease`, and an `updateDate` on **every observation** | **Open Government Licence v3.0** | `www.ons.gov.uk/robots.txt` returns **404** (re-read 2026-09-05T14:12:41Z: 404, 101,929 B, an ONS "Page not found" page with zero `disallow` lines) — unrestricted per RFC 9309, the same reading the registry already applies to `ilcc.illinois.gov` | **yes.** 125,504 B, 463 months, 2026 JUL = **144.0**, `unit: "Index, base year = 100"` |
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

- **Türkiye has no machine-readable index this plan can use.** `veriportali.tuik.gov.tr/robots.txt`
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
governed by its own terms instead. **This is genuinely the founder's call and it is Q1
below. Nothing in this plan assumes an answer.**

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
| `rise_threshold` / `step_guard` | `numeric NULL` | derived from the series' own history — §9b. **NULL means the rule cannot fire for this series**, and that is said out loud |
| `threshold_window_from` / `_to` / `_n_obs` / `_computed_at` | | so the number on the screen can be traced to the window that produced it |
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

**Two sources handled by the Michigan path instead of a fetcher**, because their hosts refuse
to state their crawl rules: the **USDA AMS shell-egg index** (`www.ams.usda.gov/robots.txt` is
403) gets a parser written against a real recorded fixture plus an upload endpoint — a
person's own download, dry run by default, staleness gate before every write, the person and
the file's sha256 on every row, exactly as `POST /price-index/upload` already does for the
Michigan price book. **BLS** waits on Q1.

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

### Phase 1 — the rule and the sentence

`commodity_exposure_rising` as §9, behind a flag defaulting off, with the storability question
answered first. Every fire records series, threshold, budget, exposure and item, so that §9d's
hit rate becomes computable later.

**What it proves:** whether a house acts on a commodity signal at all. **What it costs:** the
rule, the producer, the sentence and the panel. **What it is blocked on:** Q3.

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

Numbered for this document. None is answered here.

1. **Does `Disallow: /` on a documented, key-issuing API host bar our fetcher?**
   `api.bls.gov/robots.txt` is **200** and reads `User-agent: * / Disallow: /`, while BLS
   itself documents the API, publishes its limits and issues keys for it. The registry's
   existing precedent (Metro Türkiye) says a `Disallow: /` closes a source outright. The
   counter-reading is that robots.txt governs crawlers and an API is governed by its own
   terms. **This decides whether the richest source in this plan — the only one publishing
   an actual dollars-per-dozen price — is in or out**, and it sets a rule for every future API.
   I made **thirteen or fourteen** data requests to that host before reading its
   robots.txt, and I then omitted that robots read from the fetch log; both are corrected
   in §3c and in the log's §"Correction". The order was wrong, the count I first reported
   was too low, and I stopped after the read. **The finding itself is unchanged on a
   re-read at 14:12Z**, so this question stands exactly as posed.
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
5. **How often do you want to hear about a series?** §9b turns this from a percentage into a
   budget, and the budget is yours: about four times a year, twice, or once. On the retail egg
   series those are thresholds of 17.6, 35.7 and 57.2 percent respectively. The number is
   derived; the frequency is a decision.
6. **Is a rate a series?** HMRC duty, the GİB ÖTV schedule and the Illinois gallonage tax all
   fit `value_kind = 'rate'` cleanly, and they are exact, dated, unit-stamped and openly
   licensed — better provenance than most prices here. Putting them in this table would give
   the three non-US houses something real. It is also the second half of `price-sources.md`'s
   Q9 (the derived per-bottle duty line), which is still open, and this table would make that
   easier to build without deciding it.
