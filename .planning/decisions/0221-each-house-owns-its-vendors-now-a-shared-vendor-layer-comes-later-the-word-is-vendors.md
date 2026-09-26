# 0221 — Each house owns its vendors now; a shared vendor layer comes later; the word is "vendors"

- **Status:** Locked
- **Date:** 2026-09-25
- **Decider:** Aldemir (founder) — `AskUserQuestion`, session 6c6d8b93, round 3 (after Wave 0), 2026-09-25
- **Keywords:** vendors, providers, distributors, house scope, restaurant_id IS NULL, shared vendor, canonical vendor, world map, rename, /vendors, #416, #391, #412
- **Links:** [[0147-the-pages-endpoints-answer-only-for-the-callers-house-and-person]] · [[0149-mudavym-is-the-only-design-finish-every-page-then-delete-legacy-once]] (row 22: discovery in `/providers`) · [[0117-a-price-sighting-names-its-source-its-date-and-its-unit]] (the market box, out of scope here) · PRs #416, #412, #391 · [web-rebuild census](../07-reference/deploy/WEB-REBUILD-CENSUS-2026-09-25.md) §11

## Context

`providers.restaurant_id` is nullable (`supabase/migrations/20260805000000_baseline_from_production.sql:4882`),
and two readings of a NULL there were live on the same day:

- **#391** (`11c501d26`, merged 2026-09-21) changed `compareProviders` to read
  `.or(restaurant_id.is.null,restaurant_id.eq.<house>)` and documented a NULL-house row as
  *"a provider deliberately shared across houses"*
  (`apps/api-gateway/src/providers/provider-intelligence.service.ts:436-455` at `059169a59`;
  its spec `provider-intelligence.service.spec.ts:294`). The comment itself says the
  production count of such rows was not measured.
- **#416** (open, head `09b086fe0`) reverts that read to a plain `.eq("restaurant_id", …)`.
  Its body argues that no other vendor read shares NULL rows (`listProviders` and
  `getProvider` use `.eq`: `providers.service.ts:285-306`, `:381-393`) and that bulk import
  wrote `restaurant_id` NULL until #412, so the `.or` showed one house's imported vendors to
  every house. The bulk-import claim is #416's; this record did not re-measure it.

Which reading is right is a product question — are vendors a house's own address book, or
a shared directory? — so it went to the founder. He also asked, unprompted, for the word.

## His answer (verbatim)

As recorded in project memory `founder-answers-2026-09-25-web-rebuild.md` item 11, his words:

> "Shared vendors exist. However … some people might just have different vendors, different
> distributions, names and numbers, even though it's the same vendor. So … we're gonna let
> each house decide on its own distribution and way of handling communication … when we have
> enough data, we're going to … start to gather enough information from vendors and make them
> shared vendors exist. And that's where we're gonna see those shared vendors appear on the
> world map in the /providers page. And if you can change it, change providers to vendors."

## Options considered

1. **Shared by NULL, now** — keep #391's reading: a `providers` row with no house is shared
   and every house's reads include it. Appeals: one row per real vendor. Costs: a NULL is
   also what a bug writes (the bulk-import path #416 names), so "shared" and "leaked" are the
   same bytes; and it forces one name, one number and one contact on houses that deal with the
   same company differently — the exact case he names.
2. **House-scoped now, a shared layer later (chosen)** — every vendor row belongs to one house;
   a shared/canonical vendor layer is built later, deliberately, from gathered vendor data.
3. **Keep the word "providers"** — nothing to rename. Costs: he asked for "vendors"; the page is
   already called three things (`/providers`, `/distributors`, and vendor in `/v/:slug`).
4. *(Doing nothing leaves main's `.or` and #416's `.eq` disagreeing until whichever merges
   last wins by accident.)*

## Decision

**Now:** each house owns its vendor rows. Vendor reads are house-scoped with a plain
`.eq("restaurant_id", <house>)`; #416's `.eq` is right. A `providers` row with no house is an
**orphan**, not a shared vendor: it is shown to no house, and how orphans are found and
re-homed or retired is a later lane's measurement (never a row deletion without the founder's
word — ADR 0149's "never deleted" list). This supersedes #391's "deliberately shared" reading
of `restaurant_id IS NULL` at `provider-intelligence.service.ts:436-455`.

**Later:** a shared/canonical vendor layer, built from vendor data gathered across houses,
appears on the world map on the vendors page. What makes a vendor shared (how much data, whose
consent, how a house's own row links to the canonical one) is **not decided** — the conditions
are the founder's call when the layer is designed. The existing `restaurant_providers` join
table (`baseline_from_production.sql:5148`, `restaurant_id` and `provider_id` both NOT NULL) is
noted as a possible shape, not chosen.

**The word:** user-facing "providers" and "distributors" become **"vendors"**. The page route
becomes `/vendors`, with `/providers` and `/distributors` redirecting to it. API paths
(`/providers/...` on the gateway) and table names are unchanged unless a later decision says so.
The rename is a later implementation lane, not this record.

What carried it: his own case — the same company known to two houses by different names,
numbers and people — cannot be served by one shared row, and a NULL that means both "shared"
and "written without a house" cannot be audited.

## Consequences

- **Easier:** tenant isolation has one rule for vendor rows (ADR 0147's house scope) with no
  NULL exception to test; #416 merges with no founder fork left on it.
- **Harder / given up:** two houses buying from the same company hold two rows until the shared
  layer exists; cross-house vendor intelligence waits for it.
- **Out of scope:** the price-sighting market box's NULL-house rows (ADR 0117;
  `price-register/visibility.ts:305` `houseAndOpenMarket`) and vendor-identity suggestions
  (`vendor-intel/identity.service.ts:729`) also read `restaurant_id.is.null`. Those are not
  `providers` rows and this record does not rule on them.
- **Owed by later lanes:** (1) measure how many `providers` rows have no house in production
  (read-only; not measured here); (2) the rename, with redirects and every user-facing string;
  (3) the world map on the Mudavym page — today it lives only in the legacy page
  (`apps/web/src/pages/Providers.tsx:154-157`, lazy `DistributorMapPage`); `ProvidersNext`
  has none, and `/distributors` lands on the roster (census G8), which is also ADR 0149
  row 22's "discovery in `/providers`".
- **Revisit when:** enough gathered vendor data exists to design the shared layer, or a house
  needs to see a vendor row it does not own.

## Review trail

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-25 | Aldemir (founder, `AskUserQuestion`, session 6c6d8b93) + records lane W1 (Opus 5.5) | Locked — his answer quoted from project memory; code facts re-measured at `059169a59` and #416's head `09b086fe0` |

## Amendments — /vendors search rules (PR #484, lane W5-vendors)

This file is carried on PR #484 byte-identical to #466's copy at `6bd4ee9ff` above this
heading, so the two land together cleanly; everything below is #484's.

**[2026-09-26, founder, round 5, item 36 — built on #484 by lane W4 (commit `d6d68097b`).]**
Asked: *"/vendors: open on 'Supplies my menu' (built from what you've actually bought:
price history, orders, inventory), then 'All my vendors'. Should there be an outer rung
'Find new vendors' that searches the curated vendor catalogue we already have?"*
**Chosen:** *"Yes, add 'Find new vendors' (Recommended)"* — "Uses the existing curated
catalogue search. This is not the shared-vendor layer ADR 0221 deferred." **Rejected:**
*"No, my vendors only"* ("Discovery stays on its own page for now."). Same round, for a
house with no menu: **chosen** *"Widen + banner; show partial (Recommended)"*. Built as
`GET /providers/menu-supply` (`apps/api-gateway/src/providers/vendor-menu-supply.ts`) and
the scope bar (`apps/web/src/pages/providers/next/vendor-scope.ts`, `VendorScopes.tsx`).
The "Find new vendors" rung is the curated `vendor_catalogue` search. It is **not** the
"later" shared layer this ADR defers.

**[2026-09-26, founder, round 7, item 48 — built on #484 by lane W5-vendors.]** As
recorded in project memory `founder-answers-2026-09-25-web-rebuild.md` item 48, his
answer: *"/vendors 'Supplies my menu' = exact vintage; a NAME-ONLY search (menu filter
not applied) matches any vintage — implement now. Find new vendors defaults to the
house's country (US fallback)."* **The option texts offered in that round were not
preserved in any record this lane could read**, so the quotation above is the
memory's recording rather than the literal option. The rejected alternatives below
are this lane's reconstruction and are marked as such:

- *Vintage.* **Chosen:** the menu rung stays exact (the menu line's `wine_library_id`
  is one vintage), and a search by name, where the menu rung is not applied, matches
  every vintage. *Rejected (reconstructed):* the name search also exact, which finds
  nothing when the house bought 2018 and 2019 but typed only the name; and any
  vintage on the menu rung too, which would say a vendor "supplies my menu" for a
  vintage the menu does not pour.
- *Country.* **Chosen:** "Find new vendors" opens on the house's own country, with US
  only when that country is missing. The field stays editable. *Rejected
  (reconstructed):* always US, which is what #484 first built (`useVendorScopes.ts`,
  `useState('US')`, and it showed a house in Türkiye a US list), and guessing from
  the browser's locale.

How it is built:

- `GET /providers/wine-sellers?q=` answers "All my vendors"
  (`readOwnWineSellers`, `vendor-wine-search.ts:227`). It reads the house's own
  purchase evidence, the same three sources as the menu rung, **of all time**,
  with no 180-day window. Each vendor is labelled "Sold you <wine> <vintages> ·
  priced/ordered/stocked".
- `GET /providers/catalogue-wine-listers?q=&country=` answers "Find new vendors"
  (`readCatalogueWineListers`, `:398`). It reads price sightings (this house's
  own and openly posted ones, through `scopePriceRegisterRead` /
  `houseAndOpenMarket`) of curated, active catalogue vendors in the chosen
  country. **A sighting is not a sale**, so each wine is labelled
  "Invoiced", "Quoted" or "Listed". A sighting that names no library wine is
  quoted as the vendor wrote it. The founder's word was "sold". This rung has
  no sale evidence for vendors outside the house's book, and borrowing another
  house's would break this ADR's "each house owns its vendors".
- **Country source:** `restaurants.country` (`house-currency.service.ts:249`,
  served by `GET /settings/currency`). It holds what the address form wrote,
  such as Google's long text "Türkiye". It is resolved to ISO-2 by the one
  country table (`apps/web/src/lib/countries.ts`, `countryByName`) in
  `defaultCatalogueCountry` (`vendor-scope.ts:251`). Text the table does not
  know is not guessed at: it falls back to US, like a missing or unreadable
  country, and the hint says which of these happened. The catalogue is not
  searched until the house's country has answered, so a house in Türkiye never
  sees a US list flash first.

Readings by this lane, not founder answers:

- **A four-digit year in the query narrows to that exact vintage.** "Name-only
  matches any vintage" does not cover a query that states a year, and treated
  as text a year matches nothing, because no library name contains its vintage.
- **The match is accent- and case-blind over "producer name", with every word
  required in any order.** It is done in code over rows already scoped, never
  interpolated into a PostgREST filter.
- **The "Find new vendors" sightings are narrowed server-side on the query's
  longest word, matched against the vendor's own text** (`accentBlindLike`,
  `:394`). A sighting whose own text lacks that word but whose library row has
  it is missed.
- **The name search is not offered on "Supplies my menu".**

**[2026-09-26, founder, round 7, item 49 — FUTURE, not built.]** As recorded (item 49),
his intuition was that when menu wine X is unavailable or priced above the seasonal
market range, the wine engine would suggest a similar wine Z that sells better or
costs less at equal quality. He added that this is not for now: *"we don't have the
data"*. No UI slot was added (ADR 0020's honest states). The FUTURES/OD entry is the
records lane's (L1).

| Date | Reviewer | Outcome |
|---|---|---|
| 2026-09-26 | Lane W5-vendors (Opus 5.5), PR #484 | Items 36 and 48 recorded as built; item 49 recorded as future. Code facts are cited at #484's head. The verbatim option texts of round 7 were not available; this is stated above. |
