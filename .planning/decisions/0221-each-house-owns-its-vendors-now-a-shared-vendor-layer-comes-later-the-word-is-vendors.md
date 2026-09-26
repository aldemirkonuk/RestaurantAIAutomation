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
