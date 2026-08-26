---
type: page
route: /v/:slug
slug: vendor-public-page
component: apps/web/src/pages/VendorPortal.tsx
audience: public
tier: public
signals_today: none
rebrand_strings: 0
maturity: partial
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[vendor-prices]]"]
---

# /v/:slug — public vendor catalogue

## Surface — buttons → where they go

- **Contact email / phone** → external `mailto:` / `tel:` links
- **Website** → external vendor site URL
- (no in-app navigation — dead-end in the page graph)

## 1. Purpose
A vendor's published wine catalogue for *their* customers: searchable, sortable
(name / price-per-750ml / vintage) listing table with contact details. Double duty by
design: "read back by our own ingester as an api_catalog observation rather than a
website_scrape — which is the whole reason to host it" (`VendorPortal.tsx:40-48`).

## 2. Entry — the Growth story
**The app's only real public content route.** No auth, no tenant, no inbound in-app
link (`PAGE_MAP.md` entry-point list) — entry is entirely external: the vendor shares
their own URL, and search engines can index it via the injected schema.org JSON-LD
(`ItemList` → `Product` → `Offer` with price/currency/availability,
`VendorPortal.tsx:118-158`) plus a real `document.title` (`:154`). Every visit is a
vendor marketing *their* catalogue on Mudavym infrastructure — inbound acquisition the
platform gets for free, and the priced observations feed [[vendor-prices]] comparisons.
Route comment: `App.tsx:159-161`.

## 3. Files
- Route: `apps/web/src/App.tsx:161` (public section) → `pages/VendorPortal.tsx`
  (374 lines, fully self-contained — no shared layout, no auth context)

## 4. Endpoints
- `GET {VITE_API_GATEWAY_URL}/api/v1/vendor-portal/:slug` — direct axios
  (`VendorPortal.tsx:93-94`); ENDPOINTS.md:656-660, explicit `@Public()` 🌐
- The sibling `GET /vendor-portal/:slug/jsonld` (ENDPOINTS.md:661) is **not called by
  this page** — it serves the ingester; the page injects its own JSON-LD client-side.

## 5. Signals
none — no view tracking of any kind. For the one page whose whole point is external
reach, Growth cannot see a single visit.

## 6. Tier cut
Public — outside the subscriber tiers. Feeds S08 (drift observations) and S13
(vendor presence) from the supply side.

## 7. Rebrand surface
none. Page brands itself as the vendor (`displayName`, logo), not the platform —
which also means zero Mudavym attribution (see §9).

## 8. State & config
- `VITE_API_GATEWAY_URL` (default `http://localhost:4000`, `VendorPortal.tsx:6`)
- Client state only: search query + sort. Honest sorts: unpriced listings sort last,
  "absent is not cheapest" (`:172-182`); prices normalized to per-750ml (`:51-57`)

## 9. Gaps
- **JSON-LD is client-injected** (`:118-158`): crawlers that don't execute JS see an
  empty SPA shell — the SEO value of the schema.org block is conditional on Google-class
  rendering. The server-side `/jsonld` endpoint exists but nothing wires it into the
  served HTML.
- No OpenGraph/meta tags → vendor links shared in chat/social unfurl blank.
- No platform attribution or sign-up path anywhere on the page — the Growth loop
  (vendor's customer → Mudavym) has no hook.
- No pagination; entire catalogue in one payload/table.

---

## 10. Maturity — **partial**

The product's **only genuinely public page**, and the part that is public is built
carefully. What is missing is everything that would make it *work* as a public page.

**Genuinely public, and correctly scoped.** `@Public()` on both routes
(`apps/api-gateway/src/vendor-portal/vendor-portal.controller.ts:20-21,39-40`) — no JWT,
no tenant, addressed by slug. The exposure is deliberately bounded:

- **The column list is explicit, not `select("*")`.** The service says why: a `select("*")`
  *"would ship `edit_token` — the entire authentication mechanism for vendor editing — to
  anyone who loads the page"* (`vendor-portal.service.ts:36-44`). Page columns at `:56-58`,
  listing columns at `:71-73`; `edit_token` appears in neither.
- **Unpublished and nonexistent both 404** (`:63-67`) — the comment states the reason:
  distinguishing them would let anyone enumerate which vendors have draft pages.
- **Listings are scoped by `page_id`** resolved from the requested slug
  (`:59-60,74`). **No cross-vendor leak**: the query filters `slug = normalized` **and**
  `is_published = true`, then fetches listings for that one page id. There is no
  caller-controlled id, no join across pages, no listing route that takes a listing id.
- **Direct Supabase access is closed.** `vendor_portal_pages` and `vendor_portal_listings`
  both have RLS enabled with **zero policies**
  (`supabase/migrations/20260805155901_vendor_portal.sql:131-137`) — the migration's own
  comment: *"Exposing this table directly to anon would publish every vendor's edit
  token."* So the gateway route is the only read path, and it is the narrowed one.
- **The negotiated-price boundary holds** — the controller states that restaurant-scoped
  rates live in `vendor_price_observations` and never appear here
  (`vendor-portal.controller.ts:11-13`); nothing in the service touches that table.

**What keeps it from complete** — everything downstream of "the data is correct":

- **The SEO payload requires JavaScript.** JSON-LD is injected client-side into
  `document.head` after fetch (`VendorPortal.tsx:115-158`), and `document.title` is set the
  same way (`:154`). A crawler that does not execute JS sees the empty SPA shell from
  `vercel.json`'s rewrite (`:11-13`). The **server-side** `GET /vendor-portal/:slug/jsonld`
  exists and is `@Public()` (`vendor-portal.controller.ts:39-45`) — nothing wires it into
  served HTML.
- **The client JSON-LD is a lossier copy of the server's.** The server emits
  `countryOfOrigin`, `size` as a `QuantitativeValue` in MLT, and `eligibleQuantity` for
  multi-bottle packs (`vendor-portal.service.ts:140-166`); the client omits all three
  (`VendorPortal.tsx:131-150`). Two implementations of one contract, already diverged.
- **No OpenGraph or meta tags at all** — a link shared in chat or social unfurls blank.
- **Zero telemetry.** The one page whose entire purpose is external reach cannot report a
  single visit (§5).
- **No platform attribution and no sign-up path** — the Growth loop this page exists to
  create (vendor's customer → Mudavym) has no hook anywhere on it.
- No pagination: the whole catalogue arrives in one payload and renders as one table
  (`vendor-portal.service.ts:69-77` has no limit).

## 11. Data flow

**Calls out**

| Method | Path | Auth | Gateway controller | Returns |
|---|---|---|---|---|
| GET | `{VITE_API_GATEWAY_URL}/api/v1/vendor-portal/:slug` | **`@Public()` — none** (`vendor-portal.controller.ts:20-21`) | → `vendor-portal.service.ts:51` | `{success, page}` — slug, displayName, tagline, about, logoUrl, contactEmail, contactPhone, websiteUrl, updatedAt, and `listings[]` of productName / producer / vintage / region / country / grapeVarieties / price / currency / packSize / volumeMl / unitLabel / inStock / minOrderQuantity / leadTimeDays / notes (`:4-34`). 404 if unpublished or absent (`:63-67`) |
| GET | `…/vendor-portal/:slug/jsonld?url=` | **`@Public()`** (`:39-40`) | → `vendor-portal.service.ts:122` | schema.org `ItemList` → `Product` → `Offer`. **Not called by this page** — it serves crawlers and our own ingester |

Called at `VendorPortal.tsx:93-94`, direct axios with no shared client and no auth context.

**Fed by**

- **The vendor, by hand.** `vendor_portal_pages` / `vendor_portal_listings` are authored
  through the vendor-side editor authenticated by `edit_token` — the column this read model
  is built to never emit (`vendor-portal.service.ts:39-43`). This page is a pure read model
  over vendor-entered data.
- `vendor_portal_listings` also carries `master_wine_id` and `match_method`
  (`20260805155901_vendor_portal.sql`, indexes at `idx_vendor_portal_listings_unmatched` /
  `_wine`) — the library-enrichment work queue. **Neither is exposed on this route**
  (absent from the column list at `:71-73`), correctly: match state is ours, not the
  vendor's customers'.
- Nothing else writes here. No crawler, no cron, no agent.

**Writes**

- **Nothing.** Two GETs, both read-only; the page holds search and sort in local state.
- **Downstream, and this is the point of the page:** our own ingester reads the `/jsonld`
  route back as an **`api_catalog` observation at trust tier 3** rather than an LLM-guessed
  `website_scrape` at tier 4 (`vendor-portal.service.ts:110-117`). Those priced
  observations feed [[vendor-prices]] comparisons and S08 drift detection. A vendor typing
  a price once upgrades our data quality — the loop is real and already wired on the
  producing side.

### What an anonymous visitor can see

Everything on a **published** page, and nothing else:

- Header: logo (or a wine glyph), `displayName`, tagline, and **contact email as a
  `mailto:` link, phone as `tel:`, website as a `nofollow` outbound link**
  (`VendorPortal.tsx:221-264`) — vendor-supplied contact details, in plain text, on an
  unauthenticated page.
- The `about` blurb (`:268-270`).
- The full listing table: product, producer, vintage, region/country, grape, pack size,
  volume, in-stock flag, MOQ, lead time, notes, and **list price normalised to per-750 ml**
  (`:51-57`).
- Client-side search across product/producer/region/country/grape (`:163-168`) and three
  sorts (`:171-187`).
- The injected JSON-LD block (`:118-158`) and a real `document.title` (`:154`).

**Not visible, and confirmed absent from the payload:** `edit_token`, `master_wine_id`,
`match_method`, `is_published`, any restaurant id, any negotiated rate, any other vendor's
data. Unpublished pages return 404 rather than an "unpublished" signal
(`vendor-portal.service.ts:63-67`).

**No cross-vendor leak.** The single lookup is by slug; listings are filtered on that
page's own id (`:59-60,74`); RLS with no policies blocks the direct-Supabase route
entirely (`20260805155901_vendor_portal.sql:131-137`).

## 12. Design intent

**Should be:** a vendor's catalogue, good enough that they keep it current for their own
customers — and structured enough that we read it back as tier-3 priced data. It is the
platform's only inbound-acquisition surface, and the only page a stranger will ever see.

| State | Implemented? | Evidence |
|---|---|---|
| Empty | **partial** — a published page with no listings renders header + controls + an empty table; there is no "this vendor has not listed anything yet" copy (`:274-` has no zero-length branch) |
| Loading | **yes** — "Loading catalogue…" spinner (`:191-200`) |
| Error | **yes**, and **distinguishes 404 from failure** — *"This vendor page does not exist or has not been published yet"* vs *"Could not load this catalogue. Please try again shortly."* (`:98-105`, rendered `:202-214`). The most careful error handling of any page in this batch |
| Permission-denied | **n/a by design** — the route is public; the unpublished case is deliberately folded into 404 to prevent enumeration (`vendor-portal.service.ts:63-67`) |

**Where the UI misleads**

Almost nowhere — this page is unusually honest, and two of its honesty decisions are
worth naming as the standard the rest of the cluster should meet:

1. **Unpriced listings sort last, not first** — *"absent is not cheapest, and putting them
   first would bury the real offers"* (`:172-182`).
2. **A missing price emits no `Offer` rather than an `Offer` of zero** — *"A zero-price
   Offer is a valid document and a false statement"* (`vendor-portal.service.ts:119-121`).

The one real misdirection is **invisible to the visitor and expensive to us**: the page
appears SEO-ready — schema.org markup, a proper title — but only to JS-executing crawlers
(§10). The value it looks like it is capturing, it is mostly not.

## 13. Roadmap

1. **Serve the JSON-LD and `<title>` server-side.** The endpoint already exists
   (`vendor-portal.controller.ts:39-45`); it needs an HTML shell that embeds them before
   the SPA boots. Highest-value item: without it every other Growth investment on this page
   compounds from zero.
2. **Add OpenGraph/Twitter meta** so vendor links unfurl. Same mechanism as #1.
3. **Delete the client-side JSON-LD once #1 lands** (`VendorPortal.tsx:115-158`) rather
   than maintaining two diverging serialisers (§10).
4. **Instrument page views.** This is the page where `signals_today: none` costs the most —
   Growth cannot tell a vendor their page is working. *Blocked: needs the first real
   telemetry sink; see [[help]] §13, which has the same blocker from the opposite side
   (events with no collector).*
5. **Add a discreet "powered by Mudavym" with a sign-up path.** The Growth loop has no
   hook. *Blocked: founder decision — it trades the vendor's white-label feel (§7: the page
   brands itself as the vendor, deliberately) against acquisition.*
6. **Empty-catalogue copy** for a published page with zero listings.
7. Paginate once catalogues are large (`vendor-portal.service.ts:69-77` is unbounded).
