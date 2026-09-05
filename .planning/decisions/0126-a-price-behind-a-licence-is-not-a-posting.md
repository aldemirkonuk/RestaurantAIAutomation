# 0126 — A price behind a licence is not a posting

- **Status:** Proposed. Built read-only and inert: a catalogue endpoint, a parser and a FOIA source
  entry. Nothing was armed, no credential is stored, no request was sent, and the two questions the
  evidence forces are the founder's (Q1, Q2 below).
- **Date:** 2026-09-05
- **Decider:** Aldemir (founder) — decisions are locked by the founder, never by an agent
- **Keywords:** class C, distributor feed, Illinois, Michigan, FOIA, EDI 832, EDI 810, licensee
  price, tenancy, cross-tenant leak, robots, terms of use, absence-reported-as-health
- **Links:** [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (this answers its
  Q19 and Q20 and corrects Q19's premise), [[0114-connections-are-the-houses-profile-is-the-persons]]
  (the declared-connection shape this uses), [[0111-the-market-box-says-what-it-knows]],
  [[0020-no-fabricated-answers]], `.planning/07-reference/price-sources.md`,
  `.planning/07-reference/MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md`,
  `apps/api-gateway/src/distributor-feed/`

## Context

The founder made two calls on 2026-09-05:

> **Illinois:** *"Build the distributor connection as a class C source"* — house-declared,
> person-consented, the portal's list mirrored into the register with the distributor as issuer.
>
> **Michigan:** *"Open a standing quarterly request, filed as a source"* — one request each quarter
> for the filed beer and wine schedules.

Both calls rest on premises ADR 0117 had recorded. Research on the same day found **both premises
wrong**, in opposite directions, and the corrections are what this ADR is for. Every claim below
was fetched on 2026-09-05 with the identifying User-Agent; the full transcript with status lines is
`$SP/p4ar-fetch-log.md`.

### Illinois: there is no feed to declare, and two distributors forbid the reading

ADR 0117 Q20 said the three Illinois distributors "all price per account behind a login. That makes
class C the only route to a real Illinois number." The first half is right. The second does not
follow, and the reason is that a login is not a feed.

| Measured 2026-09-05 | Finding |
|---|---|
| `now.breakthrubev.com/robots.txt`, HTTP 200 | **`User-agent: *` / `Allow: /bbg/en/login` / `Disallow: /`.** Breakthru's own buyer portal forbids every automated reader everything except the login page |
| `breakthrubev.com/terms-and-conditions` §6.2(c) | forbids "access the Site through any automated means … (including use of scripts or web crawlers, data mining, scraping, robots, spiders, or any other data gathering or extraction tools)" |
| `southernglazers.com/terms-of-use` | forbids "any robot, spider, or other automatic device" AND, separately, **"agree not to provide any other person with access to this Website or portions of it using your username, password, or other security information"** |
| `shop.sgproof.com/robots.txt`, HTTP 200 | allows browsing but publishes `Crawl-delay: 10`, `Request-rate: 1/10` and **`Visit-time: 0400-0845`**. The research honoured it and fetched nothing on that host: the window was shut at 12:18 UTC |
| `www.breakthrubev.com/sitemap.xml`, HTTP 200 | **60 URLs enumerated in full — not one product, price or catalogue path.** The public site is corporate only |
| `analyticsapi.libdib.com/openapi.json`, HTTP 200, 70,801 B | 52 paths, 49 schemas, and the string `price` occurs **zero** times. It is LibDib's internal ML and telemetry portal. ADR 0117's registry called it "the most promising class-C connection"; that was read from the existence of a Swagger page, not from the document |
| `provi.com/partnerships/encompass`, HTTP 200 | Provi's integration runs distributor-ERP-side and is arranged by its own sales team who "complete the EDI setup". **No buyer-facing API or developer documentation on either the Provi or SevenFifty side** |

The credential clause is the one that decides it. Declaring an SG Proof login here means handing
"any other person" the account's credentials, which the terms the house agreed to forbid in as many
words. The product would be asking a manager to breach their own distributor agreement, and would
be the party that benefited.

### And the industry already answers the question a different way

| Measured 2026-09-05 | Finding |
|---|---|
| `cleo.com/trading-partner-network/southern-glazers-wine-spirits` | SGWS EDI set: **850, 856, 810, 997** |
| `truecommerce.com/trading-partner/southern-glazer/` | SGWS: **810, 850, 856** |
| Both | **No 832 price/sales catalogue on either page** |
| `docs.restaurant365.com/docs/vendor-integrations-list`, HTTP 200 | Columns are `Vendor / Multi-Invoice / Purchase Order / Order Guides`. Southern Glazers, Republic National Distributing and Youngs Market each carry a tick under **Multi-Invoice only** — Order Guides blank for all three |
| `marginedge.com/bar-inventory`, HTTP 200 | **"We update your order guides based on your invoices, so you can track orders from start to finish in one place."** |
| `fintech.com/blog/alcohol-business-management-made-simple-…` | Two options: an "EDI file integration that seamlessly inputs all your **line-item invoice data**" or an electronic data file to upload. No catalogue anywhere on the page |

So the thing the founder's call describes — a distributor price list a venue's software receives —
**is not what this industry ships to venues.** What it ships is invoices, and every buyer-side
product builds the "order guide" from them. The house's own invoices *are* the licensee price list.
Mudavym already records them, as ADR 0117 class A
(`procurement/own-paper-sighting.ts`, shipped 2026-09-04).

### Michigan: the schedules exist, and the statute embargoes them for a year

ADR 0117 Q19: *"Those are public records. A standing quarterly FOIA request would give the Michigan
houses a wine and beer posted list that exists nowhere else."*

**MCL 436.1609a** (`codes.findlaw.com`, HTTP 200, 2026-09-05 — `legislature.mi.gov` answers 403 to
`curl` and fails TLS verification to the harness fetcher, and every `michigan.gov` path answers 403
including `robots.txt`):

> "A net cash price filed under subsection (1) and a price change filed under subsection (2) are
> exempt from disclosure under section 13 of the freedom of information act, 1976 PA 442,
> MCL 15.243, **until 1 year after the net cash price or price change is filed**."

The same exemption is stated for the wine filings. So a granted request cannot return a schedule
less than twelve months old, and a quarterly request produces a rolling twelve-month-lagged series
rather than a posted list.

Two smaller corrections found on the way, both from rules read verbatim on `law.cornell.edu`
(HTTP 200): **wine** is filed "before January 1, April 1, July 1, and October 1 of each year"
(R 436.1726(1)) — the quarterly cadence is wine's; **beer** has no recurring filing date at all
(R 436.1625), only the requirement to file before an effective date and hold a reduction "at least
180 days". ADR 0117's "R. 436.1625 says the same for case and keg beer" is imprecise on the
cadence, and this is where that is corrected.

## Decision

### 1. A class-C sighting is the house's own row, not a state posting

It goes to **`vendor_price_observations`, with `restaurant_id` SET**, as
`source_type: 'api_catalog'` at `trust_tier: 3`. Not `price_index_postings`. The evidence is
structural and was read rather than argued:

- `price_index_postings` **has no `restaurant_id` column at all**, and its own migration header says
  so in words: *"NOT restaurant-scoped … a public register keyed by jurisdiction"* and *"Class A
  (own paper) and C (licensed feed) never live here"*
  (`20260904200000_a_posted_price_names_its_state.sql`). Its `source_class` CHECK admits exactly
  three values and none of them is a licensed feed.
- `belowTrailingAverage` reads `.or("restaurant_id.is.null,restaurant_id.eq.<caller>")`
  (`vendor-intel/vendor-comparison.service.ts`). **A null `restaurant_id` is visible to every house
  on the deployment.** A licensee price is one house's negotiated terms; written unscoped it is a
  cross-tenant leak of exactly the number a competitor would want.
- `vpo_source_type_check` already admits `api_catalog`, documented in that migration's own trust-tier
  table as *"3 api_catalog — vendor's own structured feed"*. **No migration is needed** — read from
  the CHECK, not assumed.
- `comparisonClassOf` (`vendor-intel/price-below-average.ts`) **already maps `api_catalog` into the
  `quoted` class, and its docblock already names that class "ADR 0117 classes A and C".** The ladder
  was built expecting this row to arrive here. The fork the brief posed was answered in code before
  it was posed.

### 2. The connection is declared and defined, and it is not offered

`DISTRIBUTOR_FEED_CONNECTION` exists with its per-distributor sub-types, its consent disclosure
written in full — what is read (a price list), what is not (orders, invoices, deliveries, credit
terms, rep messages, balances), where it lands and who can see it — and **`offerable: false` with
the reason on the same object.** There is no declare route, no credential column and no fetcher. The
catalogue endpoint is read-only and returns, per distributor, the verbatim robots rule, the verbatim
terms clause, the date it was measured and the sentence a person reads.

Writing the consent text now and the connection never is deliberate. The four disclosure questions
are answered while the decision is being taken, not on the day somebody builds the box and has to
invent them — which is how `integrations-oauth.constants.ts` came to make all four required.

### 3. The 832 parser exists, and it refuses what the standard does not say

`parse-edi832.ts` reads the subset two published implementation guides define, against two recorded
fixtures. It refuses three things rather than guessing them, and each refusal has a measured reason:

- **`unmapped_price_basis`.** `CTP02` is a Price Identifier Code the X12 standard leaves to the
  trading partners. CDW's guide defines `C01` as literally "CDW Price"; MSSS uses `CON` and `CAT`
  out of a list its own guide says holds 164. There is no universal "licensee price", so the mapping
  is an argument and an unmapped code is refused. Two mapped codes on one line is also refused —
  choosing between two trade levels is not a parser's call.
- **`no_size` / `size_unit_not_volume`.** A missing `PO4` is never a 750 ml bottle, and only `ML`,
  `CL` and `LT` are converted out of an X12 355 list SPS Commerce counts at 794 codes.
- **`no_currency`.** No `USD` default anywhere. `own-paper-sighting.ts:276`'s
  `input.currency ?? "USD"` is the measured defect that stamps every Turkish and British sighting as
  dollars; a feed parser inheriting it would spread it.

**The published fixture admits nothing, and that is why it is kept.** MSSS's own sample 832 —
transcribed character for character from a guide fetched today — carries a price on all three of its
lines, no `PO4` on any of them, and no `CUR` at all. A correct parser admits zero. A parser that
took the price without the size would have put three rows into the ladder at an unknown volume, and
`normalizeUnitPrice` would have silently ranked them.

### 4. Michigan's filed schedules become a source with `intake: "foia"`, and it states the embargo

A new registry entry, `michigan-lcc-filed-beer-wine-schedules`, withheld, with no `parse`, cadence
carrying both rules' actual wording, and:

- `standingRequest.status: "not_yet_filed"`. **Deliberately not `requested`.** Nothing has been
  sent; a drafted letter recorded as a filed request is an intention reported as an action, which is
  this repo's cardinal fault in a new coat. There is no writer and no table — moving it is a commit,
  so who filed it and when is in git.
- `statutoryEmbargoDays: 365`, and `maxAgeDays: 480` — 365 embargo + up to 91 days of quarter + ~21
  calendar days for a five-business-day answer and its single ten-business-day extension. The
  comment says in as many words that this is the arithmetic of an embargo and **not** a freshness
  allowance, so nobody copies 480 to another source.
- The request text is drafted for the **founder** to send:
  `.planning/07-reference/MICHIGAN-FOIA-BEER-WINE-SCHEDULES.md`. This session sent nothing and may
  not. The draft excludes the embargoed year on its own face so the request cannot be denied whole
  on that ground, stipulates electronic delivery in native format under MCL 15.234(3), and asks for
  a written fee estimate before any labour under MCL 15.234(4).

### 5. Two sentences a house reads are corrected

- **US-MI** used to end *"Michigan's beer and wine schedules are filed with the Commission rather
  than published, so they cannot be read at all."* True of a fetcher, wrong about a request. It now
  names MCL 436.1609a's one-year embargo — so a house is told both that the record is reachable and
  that it can never be fresh. And the upload half no longer says "these lines will fill" without
  saying with what: the book a manager can upload holds **spirits**.
- **US-IL** used to say the per-account price was *"a connection this house declares rather than an
  index anyone can read."* That pointed a house at a door nobody had tried. It now names the robots
  rule and the terms, and ends where the answer actually is: *"your own invoices … are the licensee
  price list, and this house already records them."*

### 6. No class-C line is drawn in the index panel, and that is the same decision

The brief asked for "the index panel's class C line labelled with the distributor and 'your licensee
price'". **Declined, on the ground decision 1 rests on.** `MarketIndexPanel` draws
`GET /price-index/me` — the state-keyed public register. A class-C row is tenant-keyed and lives in
the other table; putting it in that panel would either mean the index endpoint reading a
restaurant-scoped table (mixing two tenancies behind one response) or a second register drawn as
though it were a public posting. ADR 0117's own class table says class C compares to "class A and B
**for that house**" — class A is the market box's register, so class C belongs beside class A, not
beside the postings. `MarketIndexPanel.tsx` was not touched; two other builders are live in it.

The new Michigan FOIA source **does** appear on that panel today without any change to it, because
the panel already renders every withheld source with its reason.

## Alternatives rejected

**Mirror the portal with the house's own credentials, as the founder's call describes.** It is the
only design that produces a real, current Illinois price, and it is what SevenFifty-era tooling did.
Rejected on the terms, not on the engineering: Breakthru's portal robots.txt is `Disallow: /` except
the login, both distributors' terms forbid automated access, and Southern Glazer's separately forbids
providing "any other person" access with your credentials. The product would be inducing the breach
and holding the credential. If the founder wants it anyway, that is his call to take explicitly with
the clauses in front of him (Q1) — it is not a call an agent may take by building it.

**Write class C into `price_index_postings` with a `visible_to` scope column.** The brief floated it.
Rejected: it needs a migration that contradicts the table's own stated invariant, and the failure
mode is catastrophic and silent — one forgotten scope filter publishes a house's buying terms to its
state. The table with the tenancy already built and already read correctly is the one to use.

**Skip the 832 parser, since nothing sends one.** Genuinely tempting, and it is the honest reading of
the evidence. Rejected narrowly: the format is a real published standard, the parser is 300 lines of
pure function with no producer and no schedule, and it encodes three refusals that are worth having
written down whatever arrives — particularly that a `CTP02` code means nothing without the sender's
own guide. It is recorded as having **no live producer**, in the registry and in the fixture's
provenance, so nobody mistakes its existence for evidence that a distributor sends one.

**Fabricate a beverage-distributor 832 to make the fixture look real.** Rejected outright. The one
constructed fixture names its distributor `A DISTRIBUTOR THAT DOES NOT EXIST` and describes every
product as a sentence rather than a brand, and `EDI832-PROVENANCE.md` says on its first line that
neither file is a distributor's transmission.

**Send the FOIA request from this session.** Never available to an agent, and it would have been
wrong regardless: the request needs a real requester's name and postal address, and the recipient
could not be verified because michigan.gov refuses this environment.

## Consequences

- **Easier.** The Illinois box stops pointing at a door. A house is told the true thing — that its
  own invoices are its price list — and the path to that is already built. The Michigan wine house
  gets a sentence that distinguishes "unreachable" from "reachable but a year old", which no
  previous wording did.
- **Harder / given up.** There is no current Illinois wholesale number and, on this evidence, no
  lawful route to one. Michigan's wine and beer schedules cost a correspondence cycle per quarter
  and arrive a year late. Both states end up leaning on class A, which is the answer this ADR
  argues is correct and is also the least satisfying one.
- **A latent defect is named rather than fixed.** `price-index-upload.service.ts` hard-codes
  `michiganRowsFromWorkbook` + `parseMichigan` for every source key it accepts. It is correct today
  because Michigan's spirits book is the only uploadable source, and it becomes wrong the moment a
  second one exists — which the FOIA answer would be. Named in the draft's §4 and here.
- **`SourceEntry` gains two optional fields** (`intake: "foia"`, `standingRequest`). No migration:
  neither the registry nor `standingRequest` is in a database.
- **One shared file gained two lines**: `app.module.ts` registers `DistributorFeedModule`.

## What this decision does NOT settle

- **Whether the founder wants the portal mirror anyway**, with the terms in front of him. Q1.
- **Whether a twelve-month-lagged schedule is worth a quarterly correspondence cycle.** Q2.
- **What a class-C row's `price_basis` should say** once a real distributor guide exists. The parser
  takes the mapping as an argument and every registry entry's map is empty, so today it refuses
  everything — correct, and not a permanent answer.
- **Whether ADR 0117's class table should be amended** to say class C's home table explicitly. This
  ADR decides it; whether the table in 0117 is edited or left pointing here is a docs call.

## Founder-only questions

1. **Southern Glazer's terms forbid giving anyone your login. Do we build the mirror anyway?**
   The clause, verbatim: *"your account is personal to you and agree not to provide any other person
   with access to this Website or portions of it using your username, password, or other security
   information."* Breakthru's portal separately publishes `Disallow: /` for every path but its login.
   A credential-holding mirror is buildable and would give the three Illinois houses a real current
   price — at the cost of putting each house in breach of an agreement it signed, with this product
   as the beneficiary. Nothing was built either way. Build it, or is the invoice path the answer for
   Illinois?
2. **Michigan's schedules are FOIA-exempt for a year. Is a twelve-month-lagged wine and beer series
   worth a quarterly request?** The draft is written and excludes the embargoed year so it cannot be
   denied whole. Each cycle costs a letter, a fee estimate, a wait of up to fifteen business days,
   and a format nobody has seen. What arrives is history, never a price to buy against. File it, file
   it once to see the format and then decide, or leave it?
3. **A `CTP02` code means nothing without the sender's own implementation guide. Should the product
   ever accept a price whose trade level was inferred?** Today it refuses, and a house whose
   distributor sent a perfectly good catalogue would get zero rows until somebody typed the mapping
   in. That is the safe failure and it is also a dead end for a manager with a file in their hand.
   Refuse always, or let a manager map a code themselves with the mapping recorded against their
   name on every row it admits?

## Review trail

| Date | Reviewer | Note |
|---|---|---|
| 2026-09-05 | Claude (research + build, Illinois class C and the Michigan FOIA source) | **Both of the founder's premises were measured and both were wrong, in opposite directions.** Illinois: there is no feed to declare — Breakthru's buyer portal publishes `Disallow: /` for everything but its login, both distributors' terms of use forbid automated access, and Southern Glazer's separately forbids giving "any other person" access with your credentials, so a credential mirror puts the house in breach. LibDib's public OpenAPI (70,801 B, HTTP 200) was read in full: **the string `price` appears zero times**, correcting this register's "most promising class-C connection". And the industry answers the question differently anyway — SGWS's documented EDI set on two independent trading-partner pages is 850/856/810(/997) with **no 832**, Restaurant365 ticks Multi-Invoice and leaves Order Guides blank for all three wine-and-spirits distributors it lists, and MarginEdge says in one sentence "We update your order guides based on your invoices". Michigan: **MCL 436.1609a embargoes every filed net cash price from FOIA for one year**, so the standing quarterly request the founder called for can never return anything current — ADR 0117 Q19's "public records" premise is corrected here. Built: `distributor-feed/` (registry with the verbatim robots and terms per distributor, a read-only catalogue endpoint, `offerable: false` with its reason), `parse-edi832.ts` with two recorded fixtures (one real published sample that correctly admits **nothing**, one constructed and labelled as such), the `intake: "foia"` source with `status: "not_yet_filed"` and a 480-day bound documented as an embargo's arithmetic not a freshness allowance, and two corrected house-facing sentences. **Declined and argued**: the class-C line in `MarketIndexPanel`, because a class-C row is tenant-keyed and that panel draws the state-keyed register — `comparisonClassOf` already maps `api_catalog` to `quoted` and already calls that class "ADR 0117 classes A and C", so the code answered the placement fork before the brief posed it. `npx jest --runInBand --forceExit src/price-index src/distributor-feed` from `apps/api-gateway` on the tree reported here: **214 passed / 20 suites**, of which **45 in 3 suites are new here**. Nothing was armed, no credential is stored, no page on a visit-time-restricted host was fetched, and **no request was sent**. Three founder questions. |
