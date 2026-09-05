---
type: page
route: /vendor-prices
slug: vendor-prices
softwares: [vendor-price-compare]
component: apps/web/src/pages/VendorPriceCompare.tsx
audience: owner
tier: plus
archetype: list+detail # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[wines]]"]
---

# /vendor-prices — cross-vendor price comparison

> **Part of** [[08-softwares/vendor-price-compare|Vendor Price Compare]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **Wine picker** (search) → API `GET /api/v1/wines`
- Selecting a wine → API `GET /api/v1/vendor-intel/compare`
- **Add a price you were quoted** → (inline form) → API `POST /api/v1/vendor-intel/observations`
- (no page-to-page links — dead-end in the page graph)

## 1. Purpose
Pick a wine, see every vendor's observed price side by side with source provenance
(invoice / catalogue / quote / rep message / social / manual — `VendorPriceCompare.tsx:28-44`)
and 7/30/90-day trend chips, and record a manually observed price. The S08 price-drift
surface.

## 1a. Features
- Pick a wine → every vendor's observed price side by side
- Source provenance per price: invoice / catalogue / quote / rep message / social / manual
- 7/30/90-day trend chips; "No comparable data" rendered honestly, never 0%
- Record a manually observed price
- **Identity decisions log** — who confirmed or rejected which bottle identity, when, in what role, and the evidence the server showed them; a manager can undo one and the undo is logged as its own decision (ADR 0124 Q2)
- 🚧 Unreachable by navigation — no page links here (§9)

## 2. Entry
**No inbound in-app link** (`PAGE_MAP.md` entry-point list) — cold URL only. TIER-MAP
S13 Pro names this exact defect: "comparison routes unreachable". Route comment notes
the role gate is enforced server-side (owner/manager on `/vendor-intel/*`), "a hidden
route is not access control" (`App.tsx:265-268`).

## 3. Files
- Route: `apps/web/src/App.tsx:268` → `pages/VendorPriceCompare.tsx` (595 lines,
  self-contained)
- API modules: `services/api/vendorIntel.ts`, `services/api/wines.ts`

## 4. Endpoints
- `GET /wines` (search) + `GET /wines/:wineId` — wine picker
  (`VendorPriceCompare.tsx:16`; `services/api/wines.ts:30,42`)
- `GET /vendor-intel/compare?masterWineId|signatureHash&windowDays`
  (`services/api/vendorIntel.ts:63-71`; ENDPOINTS.md:651, ✅ JWT)
- `POST /vendor-intel/observations` — record a manual price
  (`vendorIntel.ts:91-92`; ENDPOINTS.md:652)

## 5. Signals
none.

## 6. Tier cut
**Plus** — S08 (vendor price drift) is the library's only `plus`-tier scenario; its
Plus row ("7/30/90 trend chips, show-your-working panel, drift flag ✅") is this page.
Pro adjacency: COGS attribution / switch-worthiness are wine-only per TIER-MAP S08.

## 7. Rebrand surface
none.

## 8. State & config
- URL search params carry the selected wine (`useSearchParams`, `:2`)
- No feature flags; retry policy skips client errors (`vendorIntel.ts:115`)

## 9. Gaps
- **Unreachable by navigation** (§2) — the page ships and nobody can find it; the
  single highest-leverage fix is a link from [[providers]] or [[wines]].
- Honesty patterns worth keeping when touched: null trend renders "No comparable
  data", never 0% (`VendorPriceCompare.tsx:100-110`); server error message shown
  verbatim, not axios's generic text (`:466`).
- Depends entirely on observation density: with only invoice-derived observations the
  comparison degenerates to one column per wine (S08's food scaffolding caveat,
  TIER-MAP S08).

## 10. Maturity

**hollow** — and it is the cleanest example in the repo, because the *code* is good.

The page renders a six-source provenance taxonomy — invoice / catalogue / quote / rep
message / social / manual (`VendorPriceCompare.tsx:28-44`) — implying six streams feed
the ladder. **One of them can produce data today, and it is the one that requires a human
to type a number into a page nobody can navigate to.**

| Evidence | `path:line` |
|---|---|
| **Only three files write `vendor_price_observations` in the whole repo.** `vendor-comparison.service.ts:254` (the manual `POST /vendor-intel/observations` this page exposes), `vendor-page-extractor.service.ts:309` (website scrape), and the analytics consensus module reads only. Nothing else — no invoice-ingest path, no catalogue import, no email extraction. | grep across `apps/api-gateway/src` + `services/agent-orchestrator`: 3 hits, one of them read-only (`analytics/engine/vendor-price-consensus.ts:51`) |
| **The scrape producer has no trigger.** `POST /vendor-intel/scrape` and `POST /vendor-intel/sweep` are owner-only routes with **zero callers**: the only web importer of `services/api/vendorIntel.ts` is this page (`VendorPriceCompare.tsx:26`), which calls neither, and there is **no `@Cron` anywhere in `apps/api-gateway/src/vendor-intel/`**. | routes `vendor-intel.controller.ts:111,135`; sweep impl `vendor-page-extractor.service.ts:325-345`; grep `Cron` in that dir → no hits |
| Consequence: the price ladder is fed **exclusively by hand-typed observations** entered on a page with **no inbound link** (§2). A user must cold-URL the page to create the only data the page can display. | §2 |
| **Where the page is honest, it is exemplary** — a null trend renders "No comparable data", never `0%`; the server's error message is shown verbatim rather than axios's generic text. These are the patterns to preserve. | `VendorPriceCompare.tsx:100-110,466` |
| Server-side authorisation is correct and role-gated, and the route comment says why hiding is not access control. | `vendor-intel.controller.ts:32-34` (`@UseGuards(JwtAuthGuard, RolesGuard)`, `@Roles("owner","manager")`); `App.tsx:265-268` |

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| GET `/wines` (search), `/wines/:wineId` | JWT | `wines.controller.ts:38,80` | wine picker options |
| GET `/vendor-intel/compare?masterWineId\|signatureHash&windowDays` | JWT + `@Roles(owner, manager)` | `vendor-intel.controller.ts:41` → `vendor-comparison.service.ts:117` | per-vendor observed prices, trust tiers, 7/30/90-day trends |
| POST `/vendor-intel/observations` | JWT + roles | `vendor-intel.controller.ts:92` → `vendor-comparison.service.ts:254` | the manual entry — **the page's only write, and the system's only reliable producer** |
| POST `/vendor-intel/scrape`, `/vendor-intel/sweep` | JWT + `@Roles("owner")` | `:111,135` | **never called by any client** |

All via `apiClient` (bearer attached); retry policy correctly skips client errors
(`services/api/vendorIntel.ts:115`).

### Fed by

| Producer | Mechanism | Status |
|---|---|---|
| Manual observation | this page's inline form | ✅ works — but requires reaching an unlinked page |
| Website scrape (`source_type: 'website_scrape'`, `trust_tier: 4`) | `sweepCatalogue` over active `vendor_catalogue` rows with a website, sequential + polite delay | ⚠️ **no caller, no cron** — `vendor-page-extractor.service.ts:309,325` |
| Invoice-derived prices | — | ❌ **does not exist.** `procurement_documents` line extraction feeds the four-way match (`procurement/invoice-match.ts`) and never writes an observation |
| Catalogue / quote / rep message / social | — | ❌ do not exist; they are enum values in the client's provenance map only (`VendorPriceCompare.tsx:28-44`) |

**Finding — the strongest on any of the twelve pages:** this page's data has, in
practice, no producer. Four of its six declared sources have no code at all, the fifth is
built but never invoked, and the sixth is manual entry gated behind an unreachable URL.

### Writes

| Write | Lands in | Downstream reacts |
|---|---|---|
| Manual price observation | `vendor_price_observations` (dedup index on `source_ref, content_hash`) | `analytics/engine/vendor-price-consensus.ts` trust-tier weighting; the S08 drift flag; nothing else |

## 12. Design intent

**Should be:** pick a bottle, see what every vendor charges for it, with each number
carrying where it came from and how much to trust it — the S08 price-drift surface.

| State | Handled? | Evidence |
|---|---|---|
| loading | ✅ | react-query |
| empty | ✅ **and honestly** — "No comparable data" rather than a fabricated 0% | `:100-110` |
| error | ✅ **and honestly** — server message shown verbatim | `:466` |
| permission-denied | ⚠️ server-enforced (`@Roles`), not client-rendered — a non-owner sees a failed request rather than an explanation | `vendor-intel.controller.ts:33-34` |

**Where the UI misleads:** the provenance legend. Displaying six source types where one
can ever appear tells the user the system is watching six channels. It is watching none
of them.

## 13. Roadmap

1. **Feed the ladder from invoices.** Every verified receipt on [[inventory]] already
   parses vendor line prices for the four-way match (`procurement/invoice-match.ts`);
   writing those as `source_type='invoice'` observations turns a dead page into the most
   trustworthy price source in the product, with the highest trust tier and zero new
   ingestion. Highest-value item on this page by a wide margin. *Blocker: none technical
   — needs a decision on trust tier and dedup key for invoice-derived rows.*
2. **Link the page.** From a provider row on [[providers]] and from a wine on [[wines]].
   It ships today and no one can find it (§2, §9). *Blocker: none.*
3. **Schedule the sweep, or delete the scrape path.** `sweepCatalogue` is written,
   polite, and never runs. Either add a `@Cron` or remove it — a producer that exists and
   is never invoked is the §44.2 pattern in server form. *Blocker: founder decision —
   scraping vendor sites has a policy dimension, not just a technical one.*
4. **Cut the provenance legend to the sources that can occur**, and grow it back as each
   producer lands.
5. Add a client-side permission state so a non-owner is told why, rather than shown a
   failed request.

### 13.x Staff may confirm, and every decision is logged (ADR 0124 Q2, 2026-09-05)

The founder, asked who may confirm a proposed bottle identity: **"staff may
confirm, log the decisions."** Built the same day; this page carries the second
half.

**The gate on this page is now two gates, and the line is what a route
exposes.** Everything else here stays owner/manager because it shows what a
vendor quoted this house — its negotiating position. The identity routes show
the question *"are these two bottles the same bottle"*: no price, no vendor, no
terms. So `identity/candidates` (the queue), `identity/candidates/decide` and
`identity/decisions` (the log) admit **staff**; `identity/decisions/undo` stays
owner/manager and is refused a second time inside the service, not only by the
decorator; and `identity/assert`, which MINTS an identity rather than confirming
one, stays owner/manager because it is a different act from the one the founder
opened.

**The log is a second table because an undo would otherwise erase what it
undoes.** `beverage_identity_candidates` holds the current state, and its
`bic_decision_is_dated` CHECK means a `pending` row has no `decided_by` or
`decided_at` — so returning a candidate to pending clears them.
`beverage_identity_decisions`
(`supabase/migrations/20260906030000_a_confirmation_is_a_logged_decision.sql`)
is append-only, enforced by a trigger that the migration proves against a real
UPDATE, and it carries what the candidate row cannot: the action (including
`undone`), the actor's **name and role as they were** (because `decided_by` is
`ON DELETE SET NULL` and a foreign key that forgets is not an audit trail), the
evidence the person saw — captured server-side, never from the request body —
and the link from an undo back to the decision it reverses.

**The list is `apps/web/src/pages/IdentityDecisionLog.tsx`**, mounted outside
the comparison's data branch so it stays readable when no wine is picked and
when the ladder itself fails. A failed read renders as a failure **with its
reason**, never as an empty log; a capped page reads "at least N" and says the
page stopped; staff see no undo control and a sentence saying why; and the query
key carries the active house so `switchRestaurant` cannot serve the previous
one's log from cache. Eight vitest cases assert exactly those.
6. **Seventeen vendors said "verified" because a geocoder ran.** ADR 0117 Q26, answered 2026-09-05: every `vendor_catalogue.verified_at` came from the two 2026-08-07 geocoding migrations applying on 2026-08-10 (`20260807001352` :32, `20260807001552` :36,52), never from a check of the website or the business; three of those websites were a casino, a wine school and a clothes shop. Cleared on the founder's word at 2026-09-05T20:35:56Z (`scripts/clear_vendor_catalogue_verified_at.py`, 17 of 17, re-read 0 left), and `20260906040000` now refuses a `verified_at` with no `source_ref`. The page prints "verified" for no vendor until something with a name verifies one.

### 13.x A price names the bottle it priced (ADR 0124 Q5, 2026-09-05)

ADR 0124 shipped `identity_id` on `restaurant_inventory`, `vendor_price_observations`
and `price_index_postings` and left `price_history` out, naming the gap in its own Q5:
grouping the ladder by identity while the house's own price series can only be joined
by `master_wine_id` makes the two registers disagree about **what a price is a price
of** — one library row covers the 750 and the magnum, which ADR 0124 measured to be two
trade items. The founder closed it in batch 49: **"Yes, identity_id on price_history
now."** Rejected: keep the two apart — the argument (a column nobody can fill until
somebody confirms an identity) loses because the cost of adding it later is not the
column, it is every row written in the meantime that can never be joined backwards
without inventing an assertion nobody made.

`supabase/migrations/20260906060000_a_price_names_the_bottle_it_priced.sql` adds the
column nullable with a `REFERENCES beverage_identities(id) ON DELETE RESTRICT`, exactly
as its three siblings. Two things differ, deliberately:

- **It backfills**, where the siblings did not. A `price_history` row already carries
  `master_wine_id`, and ADR 0124's keys table records the library link as
  `('mudavym:master_wine_library', <row id>)`, so the link is a transcription of an
  assertion somebody already made. It resolves **only where that key names exactly one
  identity** (`having count(distinct identity_id) = 1`); an ambiguous key is a refusal,
  the same refusal ADR 0124's joiner makes when a person is watching. The count is
  RAISEd unconditionally (ADR 0078 — a backfill that resolves zero rows leaves the same
  trace as one that resolves a thousand, or "no NOTICE" reads identically to "never
  ran") and then re-derived from the table and asserted.
- **The index `(identity_id, unit)` is not partial**, unlike `idx_vpo_identity` and its
  two siblings. Those filter to identified rows; here the contract is that the NULL
  group is **printed as "unidentified"** and never dropped (ADR 0016, ADR 0020), so a
  partial index would serve every part of the mandated read except the part the decision
  exists to protect.

**Readers changed: none, and that is measured rather than assumed.** On this tree
`price_history` has one writer (`recordPriceHistory`) and **zero readers** —
`grep -rn 'from("price_history")|table("price_history")|from price_history' apps services`
returns exactly one line, the insert. The ladder and the market box read
`vendor_price_observations`, which has carried `identity_id` since `20260905140000`, so
nothing there needed the identity key added. Nothing under `vendor-intel/`,
`procurement/` or `price-index/` was touched.

Instead the rule is held by a guard, so the first reader cannot get it wrong silently:
`scripts/check_price_history_reads_group_by_unit.py` gained a second arm. Grouping by
`identity_id` **without** `unit` is exit 1, not exit 2 — unlike a grouping key the parser
cannot follow, this key is visible and visibly insufficient. An identity fixes which
bottle; a unit fixes what the number counts; one bottle bought by the bottle in March
and by the case in April is two honest rows that are not addable.

### 13.y The two identity migrations, proven on PGlite after their commit (parent, 2026-09-05)

a276af97 said `20260906030000` and `20260906050000` had been executed nowhere. `p4-scratch/pglite-probe/p4aq-identity-chain.mjs` now applies the real chain `20260805154027 -> 20260904200000 -> 20260905140000 -> 20260906030000 -> 20260906050000` on stubbed leaf parents (users, restaurants, master_wine_library, restaurant_inventory, providers, vendor_catalogue): every file applies, the two new ones re-apply, all four `beverage_identit*` tables carry RLS, `asserted_for_restaurant_id` exists and `standing` is GENERATED ALWAYS — 9 passed / 0 failed.

### 13.x The writer names the bottle too, not only the backfill (ADR 0124 Q5, 2026-09-05)

The section above landed the column and backfilled it once. A backfill is a one-time
act: `recordPriceHistory` — the table's only writer — did not name `identity_id` at all,
so the column would have stopped filling the day it was created and every price recorded
from 2026-09-05 onwards would carry NULL forever. Measured on the pre-fix file
(`git show HEAD:apps/api-gateway/src/procurement/procurement.service.ts` at `c2c5725e`,
298,781 bytes), `grep -c identity_id` returns **0** — absent from the whole file, not
merely from the insert.

`apps/api-gateway/src/procurement/procurement.service.ts` now resolves the bottle at
write time through the **same** rule the backfill used, by **importing** `joinByExactKey`
from `apps/api-gateway/src/vendor-intel/identity-join.ts` rather than writing a second
implementation of it — nothing under `vendor-intel/` was edited. One distinct identity
joins; more than one **refuses**, which is ADR 0124's ambiguity doctrine applied
unattended; none stays NULL.

**Nothing in that resolution can suppress the row.** A register that could not be read is
UNKNOWN, never "this bottle has no identity" (supabase-js resolves `{ data, error }` and
never throws), so the failure is logged in words, a sentence goes onto the row's `notes`,
and the price is still written with `identity_id` NULL — a failed analytics read must not
cost the house the record of what it paid. `unknown_key` is the single silent branch, and
deliberately so: `beverage_identities` holds 0 rows in production, so a warning there
would fire on every price the platform records and teach whoever reads the log to ignore
it. The NULL on the row carries the fact instead, and
`check_price_history_reads_group_by_unit.py` already fails any reader that groups on the
column without also naming `unit`.

The one thing that could still drift is the namespace literal, which now has three
spellings — the writer's `MASTER_WINE_LIBRARY_NAMESPACE`, the private map inside
`IdentityService`, and the migration's own literal. It is pinned by an executable
`ADR-0124` row in `.planning/decisions/CLAIMS.jsonl` (the device ADR 0125 uses for
`DECLINE_INTENTS`), which also asserts that both halves of the one-key rule are still
written where they are cited. It was **proved to discriminate**: against copies of the
three files with the writer's namespace drifted, or with the joiner's
`identityIds.length === 1` altered, the command exits 1 where it exits 0 on the real tree.

Proof: `apps/api-gateway/src/procurement/a-price-names-its-bottle.spec.ts`, 6 cases —
a priced row names its bottle, an ambiguous key stays NULL with the refusal on the row, a
failed register read still writes the price and says why in words, an unidentified wine
stays NULL silently, and `identity_id` is named explicitly in all four states (never a
conditional spread). Run against a same-depth copy of the pre-fix file, **5 of the 6
fail** — only the transcription case passes, which is what it is for — and the failing key
list prints the pre-fix eleven; the probe files were deleted afterwards. On this tree
`npx jest src/procurement src/vendor-intel` is **1338 passed, 3 skipped, 1341 total**
across 71 passing suites; gateway `tsc --noEmit -p tsconfig.json` is clean.

### 13.z A shop that will not quote its own market's currency is not a source (2026-09-05, ADR 0117 Q29)

The founder, asked whether to pin Hedonism to GBP with a `?currency=GBP` hint or
a locale header: **"Not a source until it quotes GBP unprompted."**

**Hedonism Wines (`hedonism-gb`, GB-ENG) stays unarmed**, and the reason on its
row in `apps/api-gateway/src/vendor-intel/price-reference-shops.ts` now says why
in its own words rather than borrowing another block's:

> the shop's own structured data serves `priceCurrency: USD` and
> `og:price:currency: USD` to an anonymous fetcher, on a London shop whose
> jurisdiction here is GB-ENG — measured on the committed fixture
> `hedonism-ruinart-2026-09-04.fixture.html`. A USD figure filed on a GB index
> line is not the UK shelf price.

It had been filed under `terms_unstated` with a detail beginning *"Not a terms
problem but a CURRENCY one"*. It now has its own code,
`quotes_another_market_currency`, so a reader can tell the one shop blocked on
presentment currency from the two blocked on unread terms — and can count them.

**The rejected path is recorded on the row**, not just in the ADR, because a
cheaper idea that has already been turned down will otherwise be proposed again
as new: sending a currency hint would make our own fetch configuration part of
the price, and a hinted figure sitting beside an unprompted one on the same GB
line is the comparison the register exists to prevent. *A price whose currency
depends on what we sent is a price we half-made.*

**It arms only on an anonymous observation.** Every unarmed block now carries a
required `armsWhen` naming what must be SEEN for it to lift — Hedonism's demands
`priceCurrency: GBP` served to a fetcher sending no market, locale or currency
hint, and says outright that *"a GBP figure obtained by asking for GBP does not
count"*. Blocks with no stated exit get deleted for looking stale; this one
cannot be lifted by an opinion.

**Wine Chateau (`winechateau-us-nj`) stays off until a house is in its market** —
the founder confirmed it. Its exit is a fact about the estate, not the shop: a
house recording `state_province` in New Jersey. Nothing Wine Chateau does can
lift it and the row says so.

**Where it shows.** `GET vendor-intel/shop-sweep/status` now returns
`unarmedReason` and `armsWhen` beside the prose `detail` on every row, and the
run notes append "It arms when …". `armedShopKeys` already refused to arm a key
carrying a block whatever `PRICE_REFERENCE_SHOPS_ARMED` said — a test asserts
that, so the block is the mechanism rather than a note about one.

### 13.aa `vendor_catalogue.verified_at` is a stamp, not a badge (2026-09-05, ADR 0117 Q26)

All seventeen stamps were cleared in production at 2026-09-05T20:35:56Z and
`20260906040000_a_verification_names_its_source.sql` refuses a `verified_at`
naming no `source_ref`. That leaves the column NULL on every row, and **the NULL
is the dangerous part**: `if (!row.verified_at) → suspect` would turn the repair
into a demotion of every vendor in the table, and `if (row.verified_at) →
verified` was false on all seventeen.

Measured on this tree: **nothing reads it.** It is declared on the distributor
row type, returned by `search_distributors` and `vendor_catalogue_match`, and
carried to the client unread — the page's "verified only" toggle filters
`listing_tier === 'curated'`, which is a human-vetted listing and a different
fact. So there was no reading to correct, only one to prevent. The rule is
recorded where the column is declared
(`distributor-discovery.service.ts`), and `scripts/check_verified_at_is_not_a_boolean.py`
keeps it true: 13 in-scope files name the column, 0 test it, and the guard exits
2 rather than passing if its scope ever stops matching anything.
