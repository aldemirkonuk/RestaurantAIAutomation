---
type: page
route: /vendor-prices
slug: vendor-prices
component: apps/web/src/pages/VendorPriceCompare.tsx
audience: owner
tier: plus
signals_today: none
rebrand_strings: 0
maturity: hollow
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[providers]]", "[[wines]]"]
---

# /vendor-prices — cross-vendor price comparison

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
