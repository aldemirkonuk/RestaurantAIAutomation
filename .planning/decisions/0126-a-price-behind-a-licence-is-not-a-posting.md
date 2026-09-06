# 0126 — A price behind a licence is not a posting

- **Status:** Proposed. **All three founder questions answered on 2026-09-05, and all three built.**
  ~~Q1 is open and narrowed — he is asking about sanctioned APIs and a sign-in hand-over instead~~ —
  **Q1 CLOSED in batch 56: "Invoices + the built 810 ingest, and a letter for a feed."** **No mirror
  and no session hand-over of any kind is built, and none will be under this decision.** What exists:
  a read-only catalogue endpoint, the 832 parser, the FOIA source entry, the manager price-code
  mapping (§7), and — from batch 56 — the catalogue ingest through the existing document door, the
  `/connections` distributor panel and the house's invoice-feed request letter (see "BUILT,
  2026-09-05" at the end). Nothing is armed, no credential is stored, and **no request and no letter
  was sent**.
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

### 7. A manager states what a code means, and every row it admits names the statement

The founder's answer to Q3, verbatim: **"Manager maps it, recorded on every row."** Built as
`supabase/migrations/20260905240000_a_manager_states_what_a_code_means.sql` plus
`distributor-feed/price-code-mappings.ts` (pure), `price-code-mappings.service.ts` (the writes) and
three routes on the existing read-only controller.

**The statement.** One row of `distributor_price_code_mappings` per (house, sender, code field,
code): the meaning in the manager's own words, the **evidence** they had, the manager's id AND
their name as they were named when they said it, and the time. `price_basis` has **no default at
any layer** — table, DTO or UI — for the reason `mcp_tool_grants.writes` has none (ADR 0114 §3): a
default here would be this product naming a trade level nobody told it, against a house's real
money. `code_field` is a CHECK with one member, `edi_832_ctp02`, because the 832 is the only format
this repo parses; **there is no CSV feed path in `distributor-feed`**, and adding a second format
means adding a CHECK member in a migration, which is a decision rather than a typo.

**The safe refusal is still the default, and nothing is seeded.** A code with no live mapping is
still `unmapped_price_basis`, still refused, still counted. `DistributorEntry` **lost** its
`priceBasisByCode` field in this pass rather than keeping it empty: a per-distributor map shipped in
a config file is the rejected alternative below, and leaving the field there was an invitation to
fill it in.

**Every row a mapping admits names it, in a column.**
`vendor_price_observations.price_code_mapping_id` — a real column with an `ON DELETE RESTRICT`
foreign key, not a JSONB key — so the question "which statement let this price in" is one indexed
query:

```sql
SELECT v.* FROM public.vendor_price_observations v
  JOIN public.distributor_price_code_mappings m ON m.id = v.price_code_mapping_id
 WHERE m.id = $1;
```

The parser stamps `priceCodeMappingId`, `priceCodeDeclaredByName`, `priceCodeDeclaredAt` and the
sender's own `priceCode` on the sighting, plus a readable attribution sentence on `raw`.

**A withdrawal marks; it never deletes.** Withdrawing needs all three of who, when and why — a
CHECK, because a statement that stopped working and cannot say why leaves the rows it admitted
unexplainable. The withdrawn row **stays**, freeing the code for a corrected statement through a
partial unique index on the live ones, so both readings survive side by side. The mark on the rows
is **derived** — the same join with `m.withdrawn_at IS NOT NULL` — rather than a flag stamped on
each row: a stamped flag needs a backfill that can half-succeed and can then disagree with the
mapping it is supposed to reflect. One place holds the truth, and the withdrawal rewrites nothing.

**Two live meanings for one code is a refusal, not a choice.** The database forbids it and
`liveMappingsByCode` refuses it a second time rather than trusting the index — because the one
thing the parser must never do is pick between two trade levels, and a reader that silently took
the newest would be doing exactly that. A conflicted code is **removed** from the parser's map, so
the line is refused as unmapped, which is the true answer: nobody has said which reading is the
trade level.

**Proven against a real Postgres.** `$SP/pglite-probe/p4ar-code-mappings.mjs` (PGlite, PG 18.3):
**24/24 OK**. The migration's own `DO` block ran with a user and a restaurant present, so its
assertions were exercised rather than skipped; every CHECK bites from outside it too (blank
meaning, blank evidence, lowercase code, padded code, unknown code field, blank sender); the partial
index refuses a second live mapping while a **different house may read the same code differently**;
a half-withdrawal and a backdated one are refused; deleting a mapping that admitted rows raises
**23001** (`restrict_violation` — measured, not assumed: it is not 23503); the withdrawal marks
**2** rows by join and deletes **none of 3**; and the withdrawn code is mappable again with both
statements still on the table.

**BUILT ON THE PAGE, 2026-09-05 (the founder, batch 59: _"Build it on /connections in the
distributor row"_).** The three routes had no caller until this pass; they have one now, and it is
the distributor row rather than a settings screen, because a statement is about ONE sender's paper
and the distributor row is the only place this product names senders.

`apps/web/src/pages/connections/next/DistributorFeedPanel.tsx` grew a `PriceCodeRegister` under
each distributor: the live statements with the code, the meaning, **the evidence** and *stated by
&lt;name&gt; on &lt;date&gt;*; the withdrawn ones **kept**, with their reason and their day; a
withdrawal that asks for the reason FIRST and then prints the gateway's own sentence about how many
prices that statement admitted — a number, or *unknown*, never a zero. The form refuses three
things before a byte is sent, each saying **nothing was sent**: a blank code, a blank meaning, blank
evidence. It refuses nothing the gateway would admit — the code's shape, a code already live, a
session with no name are the server's judgements and its sentence is printed verbatim. The ingest
report's `unmappedCodes` are now buttons that fill that sender's form in and focus it, which is the
loop the founder described. Owner and manager only.

> **Corrected 2026-09-06** (batch 62 Q3, the founder: _"Keep the page-level refusal; correct the
> note"_). This paragraph originally read _"staff get the whole register **disabled with the
> sentence**, never hidden (ADR 0083)"_. That cannot happen on `/connections`:
> `ConnectionsNext.tsx:274-292` returns the whole page's written refusal — _"This page is for
> managers and owners"_ — **before** `DistributorFeedPanel` is mounted, a gate that predates this
> pass (commit `a9747074`, ADR 0114). The panel's `canManage=false` state is real, is disabled
> rather than hidden, and is now tested with the prop **omitted entirely** as well as passed
> `false`; it is a defence for any page that later admits staff, not a state a staff member sees
> here today. `canManage` **defaults to false** so a missing prop cannot read as permission
> (ADR 0051). The page's admission is unchanged.

`useConnectionsNextData.ts` gained read 11 and two writes. Read 11 is one query over every
distributor in the register, each sender fetched in its own request inside the queryFn and **each
failing alone**, because `useQuery` cannot be called a variable number of times and one
distributor's unreadable register must not blank another's. Two failures are kept apart: the gateway
answering `readFailed` with words, and the request never landing.

**The declared currency** now sits beside the sender picker: three characters, no default and no
placeholder, sent as `declaredCurrency`. A half-typed value is refused in the browser and nothing is
sent; a blank one is **omitted rather than padded**, because a file that states its own `CUR` is the
ordinary case and a file with neither is refused whole by the parser in its own words.

**Two defects this pass measured, one fixed.** The controller signed every statement with the
manager's **email**: it read `user.fullName`, and `JwtStrategy.validate` (`auth/strategies/
jwt.strategy.ts:55-69`) returns `name` and sets no `fullName` anywhere in the gateway —
`grep -rn fullName apps/api-gateway/src` finds only the two lines that READ it. Proved against
pre-fix code by running a probe spec on `git show HEAD:…/distributor-feed.controller.ts`, which
asserted `declaredByName === "ada@example.test"` and **passed**; fixed to `fullName ?? name ??
email` and pinned by the new `distributor-feed.controller.spec.ts`. **The identical line is still
wrong in `procurement/documents/documents.controller.ts:326`** (`uploadedByName`), which this pass
was fenced out of and names rather than fixes quietly. **Both are now closed** — the documents
controller on 2026-09-06 (batch 61 Q2, _"One-line fix now, with a spec"_), see the follow-ups below.
Second defect, unfixed at the time and a decision: a withdrawal records `withdrawn_by` (an account
id) and **no name**, so the register can say when and why but not by whom in words. The panel said
exactly that instead of printing a uuid as a person; closing it was a migration plus a controller
line, and the founder took it on 2026-09-06 (batch 61 Q1).

**Verification, on the tree this note describes.** `npx vitest run src/pages/connections` from
`apps/web` — **111 passed / 3 files**, of which **25 in 1 file are new here** (measured baseline
86 / 3 on the same command on the same tree before this pass). `npx jest --runInBand --forceExit
src/distributor-feed` from `apps/api-gateway` — **101 passed / 7 suites**, of which **7 in 1 new
suite are new** (baseline 94 / 6). Web `tsc --noEmit`: 0 errors. Gateway `tsc --noEmit` on both
`tsconfig.json` and `tsconfig.spec.json`: 0 errors. `check_web_reads_gateway_dto_keys`,
`check_read_errors_not_swallowed`, `check_windowed_figures`, `check_money_states_its_currency`,
`check_route_exposure`, `check_no_seeded_defaults`, `check_read_columns_exist`,
`check_queried_tables_exist`, `check_new_tables_are_locked_down`, `check_fk_targets_exist`,
`check_flag_readby_anchors`, `check_order_capture_contract`, `check_adr_numbers_unique` and
`check_decision_claims.sh` all **exit 0**; `scripts/check_gateway_boots.sh` answers **PASS**. **No
migration.** Both grounds captured against a **stubbed** gateway
(`$SP/shoot-price-codes.mjs` → `$SP/shots-price-codes/`, every `/api/v1/**` request fulfilled in the
harness so nothing reached :4000): paper `--paper-0` computed `rgb(250, 247, 241)`, charcoal
`rgb(21, 19, 15)`. **No row was written to any database and no route was called on a live gateway.**
`eslint` could not be run **by the builder** — `eslint-plugin-jsx-a11y` is absent from every checkout
on this machine, which is a known environment fault, not a clean result. **The parent then ran it**
on the index archive with `eslint-plugin-jsx-a11y` **6.10.2** resolved from `p4-scratch/web-lint`
(`--resolve-plugins-relative-to`), **exit 0** — which is what commit `da71cebe`'s message records.
Both facts stand and neither replaces the other: a builder that cannot lint says so, and a parent
that could says how it did. *(Amended 2026-09-06; the sentence here gave only the first half and so
read as a contradiction of the commit message — audit of `da71cebe`, BLOCKING 2.)*

### The follow-ups closed, 2026-09-06 (the founder, batches 61 and 62)

**A withdrawal names the person who made it.** _"Add withdrawn_by_name now."_ The second defect
named above is closed: `supabase/migrations/20260906150000_a_withdrawal_names_the_person_who_made_it
.sql` adds `withdrawn_by_name TEXT` with
`distributor_price_code_mappings_withdrawer_is_named` — present **exactly** when `withdrawn_at` is,
blank refused. It is **additive**: the older `_withdrawal_is_whole` CHECK is left alone rather than
dropped and widened, because dropping a live CHECK to rewrite it opens a window in which the old
rule is not enforced. **Nothing is backfilled** — there is no name to backfill with, so the file
asserts that no withdrawn row lacks one and RAISES with the count if any does, rather than writing a
signature nobody gave. The controller signs the withdrawal from the session with the same
`fullName ?? name ?? email` chain the statement uses; the service refuses an empty name in words
(_"the withdrawal must name the person making it"_) rather than letting the CHECK answer with a
23514. The panel prints _withdrawn by &lt;name&gt; on &lt;date&gt;: &lt;reason&gt;_, and a
withdrawal recorded before this migration says it holds no name instead of printing a uuid.
Measured on PGlite (`p4-scratch/pglite-probe/p4bn-withdrawn-by-name.mjs`, applying
`20260905240000` then this file **twice**): **7 accepted/applied, 6 refused, 0 errors** — the
unnamed withdrawal, a whitespace name, an empty-string name and a name with no withdrawal are all
`23514`, and the two older withdrawal CHECKs still fire on a missing reason and a missing withdrawer.

**A file's `CUR` disagreeing with the declaration refuses the whole file.** _"Refuse the file,
naming both."_ `parse-edi832.ts` had let the file's own `CUR` win silently, discarding the manager's
typed declaration with no trace in the response (audit of `da71cebe`, finding 3). It now refuses the
document with a new `currency_disagreement` reason and the sentence _"the file states EUR and the
declaration says USD; nothing was read"_, surfaced through `refusedWhole` exactly as the parser's
other whole-file refusals are and printed verbatim by `DistributorFeedPanel`. Agreement (the same
code twice) and absence (no declaration) are unchanged. **The 810 path is untouched and that is
measured, not assumed**: `grep -rn declaredCurrency apps/api-gateway/src apps/web/src` shows
`declaredCurrency` reaching only `admitCatalogue`, which runs only behind `looksLikeEdi832`, so the
invoice reader never sees a declared currency to disagree with. It carries a separate
`?? "USD"` default at `procurement/documents/x12/x12-invoice.ts:254-257`, which is named here and
**not** changed: it is a different question, on a path this pass was fenced out of.

**The founder's third batch-62 answer, recorded and unchanged in code.** _"Keep as built"_ on the
currency field: blank omitted rather than padded, a partial value refused in the browser, and a file
with neither `CUR` nor declaration refused whole by the parser naming both absences. Nothing was
built for it because it was already the behaviour; it is written here so the reading is on the
record.

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

**Refuse always (Q3's other option).** Simplest, safest, and it was this pass's own default: a code
nobody can vouch for is never priced. Rejected by the founder, and the reason it deserved to lose is
that the refusal has no exit — a manager holding their distributor's own implementation guide, able
to read the meaning off page 7, had no way to tell the product and would watch a valid catalogue
produce zero rows forever. The safety it bought was real but it was bought by making the product
unable to learn something a person already knew.

**Mudavym maintains the mappings — a code table shipped in the registry.** Cheaper for every house
after the first, and it is what the first draft of `distributor-feed.registry.ts` was shaped for
(`priceBasisByCode`, empty, per distributor). Rejected: a trade level is negotiated per licence, so
one house's `CON` is not another's — the PGlite probe demonstrates two houses reading the same code
differently and the schema permits it deliberately. A meaning shipped centrally would be this
product asserting, for every house at once, a term of an agreement it is not party to and has never
read. The field was deleted rather than left empty, because an empty field is an invitation.

**Stamp a `mapping_withdrawn` flag on each admitted row.** It makes the mark literal and needs no
join. Rejected: it is a backfill that can half-succeed, and the day it disagrees with the mapping it
reflects there is no way to tell which is right. The join cannot drift, and "marked, not deleted" is
satisfied by a row that still points at a statement now marked withdrawn.

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
- **One new table and one new column** (2026-09-05, Q3): `distributor_price_code_mappings` (RLS on,
  anon/authenticated revoked, in-file assertions exercised) and
  `vendor_price_observations.price_code_mapping_id`. Nothing writes the column yet — no ingest path
  for a distributor catalogue exists, because no distributor was found to send one — so it is
  dormant by design and the parser that would fill it is proved by fixture.
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

   **STILL OPEN, and narrowed by the founder on 2026-09-05:** he is asking instead about
   **sanctioned APIs and a sign-in hand-over** — a route the distributor itself offers rather than
   one taken around it. An answer is coming. Until it lands, **no mirror of any kind is built**:
   there is still no declare route, no credential column and no fetcher, and the catalogue still
   carries `offerable: false`.
2. **Michigan's schedules are FOIA-exempt for a year. Is a twelve-month-lagged wine and beer series
   worth a quarterly request?** The draft is written and excludes the embargoed year so it cannot be
   denied whole. Each cycle costs a letter, a fee estimate, a wait of up to fifteen business days,
   and a format nobody has seen. What arrives is history, never a price to buy against. File it, file
   it once to see the format and then decide, or leave it?

   **ANSWERED, 2026-09-05: a standing quarterly request, filed as a source.** That is what the
   register holds — `michigan-lcc-filed-beer-wine-schedules`, `intake: "foia"`, cadence carrying
   both rules' own wording, `maxAgeDays: 480` documented as the embargo's arithmetic. The status
   stays `not_yet_filed` until a person files it, because a drafted letter recorded as a filed
   request is an intention reported as an action.
3. **A `CTP02` code means nothing without the sender's own implementation guide. Should the product
   ever accept a price whose trade level was inferred?** Today it refuses, and a house whose
   distributor sent a perfectly good catalogue would get zero rows until somebody typed the mapping
   in. That is the safe failure and it is also a dead end for a manager with a file in their hand.
   Refuse always, or let a manager map a code themselves with the mapping recorded against their
   name on every row it admits?

   **ANSWERED and BUILT, 2026-09-05. The founder: *"Manager maps it, recorded on every row."*** See
   the section below.

## Review trail

| Date | Reviewer | Note |
|---|---|---|
| 2026-09-05 | Claude (build, Q3 — the manager maps the code) | **Q3 ANSWERED by the founder in his own words — *"Manager maps it, recorded on every row"* — and BUILT.** `20260905240000_a_manager_states_what_a_code_means.sql`: `distributor_price_code_mappings` (one statement per house per sender per code — the meaning, the **evidence**, the manager's id AND the name they bore when they said it, the time; **no DEFAULT on `price_basis` at any layer**, asserted in-file; `code_field` a CHECK with one member because **there is no CSV feed path in this repo**), plus `vendor_price_observations.price_code_mapping_id` as a **column** with an `ON DELETE RESTRICT` foreign key, so "which statement let this price in" is one indexed query rather than a JSONB hunt. **A withdrawal marks and never deletes:** all three of who/when/why or the CHECK refuses it, the withdrawn row STAYS and a partial unique index frees the code for a corrected statement, and the mark on the admitted rows is the JOIN to `withdrawn_at` — derived rather than stamped, because a stamped flag is a backfill that can half-succeed and then disagree with the mapping it reflects. **The safe refusal is still the default**: nothing is seeded, and `DistributorEntry` LOST its `priceBasisByCode` field rather than keeping it empty, because a per-distributor map shipped in a config file is the rejected alternative "Mudavym maintains the mappings" — a trade level is negotiated per licence, and the probe demonstrates two houses reading the same code differently. **Two live meanings for one code is refused twice** (the index, and `liveMappingsByCode` again) and the code is REMOVED from the parser's map, so the line is refused as unmapped — the one thing the parser must never do is pick between two trade levels. **Proven against a real Postgres** (`$SP/pglite-probe/p4ar-code-mappings.mjs`, PGlite / PG 18.3): **24/24 OK**, the in-file `DO` block EXERCISED (a user and a restaurant exist in the fixture, so the skip branch was not taken), every CHECK biting from outside it as well, a different house mapping the same code differently, deleting a mapping that admitted rows raising **23001** — `restrict_violation`, measured, not the 23503 this probe first expected — and the withdrawal marking **2** rows by join while deleting **none of 3**. **Q2 also answered** (a standing quarterly request, filed as a source — which is what the register already holds, `status` still `not_yet_filed` because nobody has filed it) and **Q1 narrowed**: the founder is asking about sanctioned APIs and a sign-in hand-over, so **no mirror of any kind was built** and the catalogue still carries `offerable: false`. Verification: `npx jest --runInBand --forceExit src/distributor-feed src/price-index` from `apps/api-gateway` — **284 passed / 24 suites**, of which **24 cases in 1 suite are new here**; gateway `tsc --noEmit -p tsconfig.spec.json` — my files clean, the 9 remaining error lines all in `communications/`, `procurement/` and `ux-optimizer/`, three directories this pass was told to keep out of; web `tsc --noEmit` **0 errors**; `check_new_tables_are_locked_down`, `check_fk_targets_exist`, `check_read_columns_exist`, `check_queried_tables_exist`, `check_no_seeded_defaults`, `check_order_capture_contract` and `check_migration_versions_unique` all **exit 0**; migration prefix uniqueness empty. **No row was written to any database and no route was called on a live gateway.** |
| 2026-09-05 | Claude (research + build, Illinois class C and the Michigan FOIA source) | **Both of the founder's premises were measured and both were wrong, in opposite directions.** Illinois: there is no feed to declare — Breakthru's buyer portal publishes `Disallow: /` for everything but its login, both distributors' terms of use forbid automated access, and Southern Glazer's separately forbids giving "any other person" access with your credentials, so a credential mirror puts the house in breach. LibDib's public OpenAPI (70,801 B, HTTP 200) was read in full: **the string `price` appears zero times**, correcting this register's "most promising class-C connection". And the industry answers the question differently anyway — SGWS's documented EDI set on two independent trading-partner pages is 850/856/810(/997) with **no 832**, Restaurant365 ticks Multi-Invoice and leaves Order Guides blank for all three wine-and-spirits distributors it lists, and MarginEdge says in one sentence "We update your order guides based on your invoices". Michigan: **MCL 436.1609a embargoes every filed net cash price from FOIA for one year**, so the standing quarterly request the founder called for can never return anything current — ADR 0117 Q19's "public records" premise is corrected here. Built: `distributor-feed/` (registry with the verbatim robots and terms per distributor, a read-only catalogue endpoint, `offerable: false` with its reason), `parse-edi832.ts` with two recorded fixtures (one real published sample that correctly admits **nothing**, one constructed and labelled as such), the `intake: "foia"` source with `status: "not_yet_filed"` and a 480-day bound documented as an embargo's arithmetic not a freshness allowance, and two corrected house-facing sentences. **Declined and argued**: the class-C line in `MarketIndexPanel`, because a class-C row is tenant-keyed and that panel draws the state-keyed register — `comparisonClassOf` already maps `api_catalog` to `quoted` and already calls that class "ADR 0117 classes A and C", so the code answered the placement fork before the brief posed it. `npx jest --runInBand --forceExit src/price-index src/distributor-feed` from `apps/api-gateway` on the tree reported here: **214 passed / 20 suites**, of which **45 in 3 suites are new here**. Nothing was armed, no credential is stored, no page on a visit-time-restricted host was fetched, and **no request was sent**. Three founder questions. |

## Q1, researched from three angles and judged (2026-09-05)

The founder asked (batch 48): *"deploy 3 opus agents, look from diff angles, focus on the
effect on the customer the most. How would it affect to our benefit, and we create our own
price market."* Three researchers wrote `p4-scratch/p4be/p4be-customer.md` (the Illinois
house), `p4be-market.md` (Mudavym's own price market and buyer-side information-exchange
law) and `p4be-law.md` (the distributors' terms, the case law, the sanctioned routes, a
draft letter), each with a fetch log; a Sonnet adversary tried to kill each answer
(`p4be-adversary.md`): angle 1 WOUNDED, angle 2 WOUNDED, angle 3 SURVIVES with one defect
in its fetch log (an unlogged request that no claim rests on) and one self-correction.

**What changes in this ADR.** (1) The Southern Glazer's clause this ADR quotes governs
`southernglazers.com` — its Terms define "Website" as that host — and NOT the buyer portal
`shop.sgproof.com`, whose own terms nobody has read (its visit window was shut); the registry
and the house-facing sentence applied the corporate terms to the portal. (2) Breakthru's
§6.2(a) ("access our Services by any means other than through the interfaces that are
provided") is broader than the §6.2(c) quoted here, and §6.2(e) ("reproduce, duplicate, copy
any aspect of the Site for any purpose") on its face reaches a manual export too — so the
hand-export path is cleaner than a mirror, not clean. (3) 720 ILCS 5/17-51 (Illinois computer
tampering: "accesses or causes to be accessed" in excess of authority; no $5,000 loss floor;
a customer safe harbour only where the customer "complies with all terms") is the sharper
risk than the CFAA, whose case law (Van Buren; Power Ventures — user consent is "akin to
allowing a friend to log on", and a ToS breach "without more" is not a violation until a
cease-and-desist; hiQ, which distinguishes password-gated access; Ryanair) runs the other
way from what this ADR implied; no Illinois case applies 17-51 to a licensee's own tool, and
the researcher is not a lawyer. (4) A sign-in-then-hand-over escapes the SGWS credential
clause on its literal words and lands on the two clauses above; it is not an escape.
(5) No distributor API or EDI programme exists that a house can be granted; what exists is
platform-level and Mudavym would apply. Restaurant365's vendor table: 18 of 214 vendors ship
an order-guide feed, zero of them beverage alcohol; SGWS, RNDC and Youngs offer multi-invoice
only. (6) Illinois genuinely has no price-posting regime (the Liquor Control Act's one
"schedule of prices" is the retail happy-hour rule; 11 Ill. Adm. Code 100 has no filing
phrase), but 11 Ill. Adm. Code 100.500 requires a distributor's quantity discount to be
offered alike to similarly situated retailers in the same area — a uniformity hypothesis
worth testing on the first three real Illinois invoices. (7) The access route was never the
binding constraint on the product: `priceBelowAverage` needs three earlier sightings plus the
newest inside thirty days per bottle, so a catalogue mirror (one row per edition) would not
make the market box speak; `parseEdi832` has zero production callers, no upload route accepts
a distributor catalogue, `apps/web/src` has zero references to `distributor-feed`, and the
EDI 810 invoice path Mudavym already parses end to end has never been asked for. (8) Provi
(Chicago, national RNDC agreement since 2025-07-28) already shows a licensed Illinois buyer
cross-distributor prices lawfully. (9) An owned cross-house price market is not a near-term
substitute: every regime (US DOJ/FTC factors; the Agri Stats consent decree of 2026-05-07 —
at least three contributors, no one above 70 %, a 45-day lag, sales-price data stopped
"regardless of whether anonymized"; EU/UK; Türkiye) permits a buyer-side pool only
aggregated, lagged and openly accessible, and the estate has at most three houses in any
jurisdiction, zero rows in the register, and a `restaurant_id` with two states enforced by
nine hand-written filters and no RLS policy; whether the three Illinois "houses" are real
independent competitors or demo tenants was never asked. (10) Illinois's cooperative
purchase-group statute (235 ILCS 5/6-9.5 to 6-9.15) is the one lawful structure in the corpus
that does what "our own price market" describes; nobody has evaluated it as a product.

**The judged path, proposed to the founder.** No mirror and no session hand-over of any
kind. For Illinois now: the house's own invoices (class A) plus the EDI 810 ingest that is
already built, which needs a producer and a surface, not a new capability; a hand-obtained
832 through the upload path with the manager's code mapping (0e4b67ed) as the second way in;
a letter from the house (angle 3's draft, for the founder's eyes, never sent by this product)
asking its Sales Consultant for what this industry already grants foodservice buyers — an
invoice feed or an order-guide equivalent — starting with Southern Glazer's, which documents
an EDI programme. The owned price market stays a note until there are three to five
independent houses in one jurisdiction and the database has a third visibility state, one
enforcement point and an RLS policy. The founder decides; nothing in this section is built.

## Q1 CLOSED, and three more answers (founder, 2026-09-05, batch 56)

**Q1 — "Invoices + the built 810 ingest, and a letter for a feed."** No mirror and no
session hand-over of any kind. For Illinois: class A (the house's own invoices) plus a surface
and a producer for the EDI 810/832 ingest that already exists; the house sends its Sales
Consultant a letter asking for an invoice feed or order-guide equivalent. Rejected: a
house-armed session hand-over (escapes the credential clause on its words and lands on two
broader clauses plus 720 ILCS 5/17-51); hold everything for Illinois because Provi covers it.

**The letter — "The house signs; SGWS first, asking for 810."** A real Illinois house's
owner signs on their own letterhead with Mudavym named as the software; Southern Glazer's
first (a documented EDI programme); the ask is an EDI 810 invoice feed, not an 832 catalogue.
Rejected: Mudavym signs on the house's written authority; no letter yet. The draft
(`p4-scratch/p4be/p4be-law.md`) moves into `07-reference/` as a document for the house to
sign; this product never sends it.

**The census — "All real."** Asked whether the fifteen census houses, and specifically the
Illinois trio (YARDOM, YAREN, Yaren's Fine Dine) and ADMIN 1 / Sim Bistro, are real
independently owned restaurants or test tenants, the founder answered that they are all
real. Recorded as his statement; the memory note of 2026-08 that counted one real tenant is
superseded by it for the purpose of this decision. Consequence he accepted with the option:
the contributor floors researched in `p4be-market.md` apply as written, and the register's
tenancy boundary (nine hand-written filters and no RLS policy) must be fixed before any
cross-house read — dispatched as its own build.

**The surface — "Build the ingest route and the panel."** An upload route that accepts a
house-obtained 832 or an 810 through the existing document door, the manager's code mapping
(0e4b67ed) applied, and a /connections panel that says per distributor what is true today.
Rejected: mark the pieces dormant on purpose.

### BUILT, 2026-09-05 — the three of them, and one correction

**The ingest is the document door, not a second door.** `POST /procurement/documents` already
hashed, deduplicated, stored and provenanced a file; it now recognises an 832 as well.
`document-intake.service.ts` classifies it as a `price_list` — one of the twelve doc types the
spine already admits — with its `BCT` number, its `N1*SU` sender, its `DTM*007` date and its
`CUR` currency, **and no lines**, because a `price_list` line would be a price and a price this
house may see is one a manager's statement admitted. What the door did before was measured
rather than assumed (`document-intake-catalog.spec.ts`, first case, run against the UNCHANGED
`parseX12`): `looksLikeX12` says true, the envelope reader never opens the `ST` — it warns *"SE
encountered with no open ST"* — so the file produced **zero transactions and zero skips**, and
`route()` answered "EDI file produced no readable transaction sets" with docType `unknown`,
confidence 0 and **`currency: "USD"` stamped on a document whose currency nobody had read.**

**The prices are admitted separately, and every refusal is named.**
`distributor-feed/catalog-ingest.service.ts` reads the house's live statements, runs
`parseEdi832`, writes the admitted rows to `vendor_price_observations` with
`price_code_mapping_id` set and a `raw.handover` block carrying **who uploaded it, when, the
file's sha256, the filename, the stored document id and the sender**. The report is per line:
what was priced and under whose statement, and for each refused line the reason and the detail.
`Edi832Run` gained `unmappedCodes` so the codes come back **by name** — the one refusal a person
can fix. Three states are kept apart that a row count would collapse: **admitted**, **already
recorded** (a 23505 on the `(source_ref, content_hash)` index — a re-upload after finally stating
a code is the ordinary case) and **write failed**, which is never counted as admitted and comes
back in the database's own words. A mapping read that FAILED refuses the whole document with the
read's reason: parsing against an empty map would refuse every line as `unmapped_price_basis` and
blame the distributor for our own database error.

**The door stays open to staff; the price register does not.** `POST /procurement/documents`
carries `JwtAuthGuard` and no role gate, and it must: a runner photographs paper at the delivery
door, and a role check there would lose documents at the moment they arrive. So the gate sits on
the act that writes prices — `CatalogIngestService.admit` calls
`assertCanManageRestaurant` before it reads a mapping — which is the posture the price-code
statements themselves already carry (§7) and the one ADR 0114 sets. It is **not** a thrown 403:
the document is already stored by the time the check runs, and a throw would turn
stored-and-not-priced into "your upload failed", so the refusal comes back as the catalogue's own
answer naming the rule and saying the file is on the record. The upload is not sealed, and that is
deliberate — an upload is not money, and the write it can cause is a price sighting a manager can
see, question and have withdrawn.

**The panel says what is true and offers the two ways in.**
`apps/web/src/pages/connections/next/DistributorFeedPanel.tsx`, mounted on `/connections` between
Register I and Register II — deliberately **not** a fifth register, because every row on it is
something that cannot be attached. Per distributor: the robots rule and the terms clause
verbatim, the day they were read, `connectable: false` and the measured reason. Then the two ways
in: hand over a file you obtained (a real control, posting to the document door, printing the
per-line report) and ask your Sales Consultant (the letter, as a download). A failed register read
is named with the gateway's own sentence; `silence` is printed rather than an empty list.

**The letter.** `.planning/07-reference/DISTRIBUTOR-INVOICE-FEED-LETTER.md`, served verbatim by
`GET /distributor-feed/letter` from `feed-request-letter.ts`. It asks for an **EDI 810 invoice
feed** or an order-guide equivalent — the scratch draft led with an 832, which is the thing
nobody sends — names Mudavym as the software and the house as the signatory, and carries seven
brackets this product does not hold and will not guess. **This product never sends it and has no
route that could**, said in the file, on the panel and in the constant.
`feed-request-letter.spec.ts` reads the reference document off disk and fails if the served text
and the printed text ever differ.

**The correction this pass owed.** The registry's `southern-glazers-il` row, this ADR's Illinois
table and the sentence a house reads all quoted `southernglazers.com`'s Terms of Use as if they
governed the **SG Proof buyer portal**. They do not: those Terms define "Website" in their own
first paragraph as `southernglazers.com`, and `shop.sgproof.com` is a different host whose own
terms **nobody has read** — the visit window was shut on both passes. The registry now says
exactly that, and says an unread term is not a permissive one. Corrected in the same words in
`price-sources.md`'s SGWS row. The corporate clause still stands where it says it applies.

**Verification, on the tree this note describes.** `npx jest --runInBand --forceExit
src/distributor-feed src/procurement/documents` from `apps/api-gateway` — **293 passed / 20
suites**, of which **33 cases in 3 suites are new here** (against a measured baseline of 260 / 17
run on the same command on the same tree before this pass). `npx vitest run src/pages/connections` from `apps/web` —
**86 passed / 3 files**, of which **19 in 1 file are new** (baseline 67 / 2). Gateway
`tsc --noEmit` on both `tsconfig.json` and `tsconfig.spec.json`: **0 errors**. Web `tsc --noEmit`:
**0 errors**. `check_route_exposure`, `check_read_errors_not_swallowed`, `check_read_columns_exist`,
`check_web_reads_gateway_dto_keys`, `check_no_seeded_defaults`, `check_fk_targets_exist`,
`check_new_tables_are_locked_down`, `check_order_capture_contract` and `check_adr_numbers_unique`
all **exit 0**. **No migration** — `vpo_source_type_check` already admits `api_catalog` and
`price_code_mapping_id` already exists. **No row was written to any database and no route was
called on a live gateway.**

**Two things this pass could NOT verify, stated.** `scripts/check_gateway_boots.sh` **cannot run
on this tree**: its `npx nest build` fails on a syntax error in
`apps/api-gateway/src/commodity/commodity.service.spec.ts`, a file another builder has open and
this pass may not touch. The equivalent check was run instead — `tsc` build (which excludes
specs) plus the guard's own `NestFactory.createApplicationContext(AppModule)` runner with the
same placeholder environment — and answered **BOOT_OK**, so the new `ProcurementModule` →
`DistributorFeedModule` import and the controller's fifth dependency resolve. And
`check_queried_tables_exist.py` **exits 1** on this tree for a reason that is not this pass's: the
unresolvable-table set grew from 26 to 27, and the 27th is in
`apps/api-gateway/src/analytics/goal-scenario-requests.service.ts`, an untracked file belonging to
another builder. Every table this pass queries is a string literal.
