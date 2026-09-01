---
type: software
slug: vendor-price-compare
name: Vendor Price Compare
division: vendor
status: hollow
tier: plus
routes: ["/vendor-prices"]
pages: [vendor-prices]
api_modules: [vendor-intel, wines]
agents: []
owner_unit: supply-discovery
updated: 2026-09-01
links: ["[[vendor-prices]]", "[[vendor-directory]]", "[[global-vendor-search]]", "[[vendor-portal]]", "[[supply-discovery-charter]]", "[[SOFTWARE-MAP]]"]
---

# Vendor Price Compare

## §0 What it is

Pick a wine and see what every supplier charges for it, side by side, with where each
number came from and whether it has moved in the last week, month or quarter. It is the
answer to "am I being quoted a fair price?" — and today it can only answer that if
somebody has typed the prices in by hand.

## §1 Features today

- Search for a wine and select it
- See every vendor's observed price for that wine in one table
- See where each price came from — invoice, catalogue, quote, rep message, social, manual
- See 7 / 30 / 90-day trend chips, with "No comparable data" rendered honestly rather than 0%
- Type in a price you were quoted and have it join the comparison
- Reach this screen from anywhere in the product — **absent**: there is no inbound link at
  all (§2)
- Be fed by anything other than hand entry — **dark**: five of the six advertised sources
  have no producer (§7)

## §2 Screens

- [[vendor-prices]] — the whole software, one route, one self-contained component
  (`apps/web/src/pages/VendorPriceCompare.tsx`, 595 LOC).

Route at `apps/web/src/App.tsx:297`, **not** `PageGate`-wrapped — there is no `next`
variant, so what you see is what ships.

**No inbound in-app link anywhere.** Entry is cold URL only ([[vendor-prices]] §2;
`PAGE_MAP.md` entry-point list). [[vendor-directory]] — the vendor hub built for exactly
this question — never links here, which TIER-MAP S13 Pro names as the defect
*"comparison routes unreachable"*. The route comment says the role gate is enforced
server-side and that *"a hidden route is not access control"*.

## §3 Backend

`apps/api-gateway/src/vendor-intel/` — `@Controller("vendor-intel")` at
`vendor-intel.controller.ts:32`, class-guarded `@UseGuards(JwtAuthGuard, RolesGuard)` with
`@Roles("owner","manager")`. **4 routes**, of which this page calls two:

| Endpoint | Controller | Called by this page |
|---|---|---|
| `GET /vendor-intel/compare` | `vendor-intel.controller.ts:41` | ✅ `services/api/vendorIntel.ts:63-71` |
| `POST /vendor-intel/observations` | `:92` | ✅ `vendorIntel.ts:91-92` |
| `POST /vendor-intel/scrape` | `:111` | ❌ zero callers |
| `POST /vendor-intel/sweep` | `:135` | ❌ zero callers |

Plus the wine picker against `apps/api-gateway/src/wines/` —
`@Controller("wines")` at `wines.controller.ts:30`, using `GET /wines` (`:38`) and
`GET /wines/:wineId` (`:80`) via `services/api/wines.ts:30,42`.

**Correction to the module list this note was commissioned with:** `vendor-catalogue` is
not part of this software. Its client (`services/api/vendors.ts`) is imported only by the
providers components and the distributor drawer — see [[vendor-directory]] §3 and
[[global-vendor-search]]. `services/api/vendorIntel.ts` has exactly one importer in the
repo: `VendorPriceCompare.tsx:26`.

## §4 Automation

`none` — and that is the defect, not a design choice. `POST /vendor-intel/scrape` and
`POST /vendor-intel/sweep` exist as owner-only routes with **no caller and no schedule**:
there is **no `@Cron` anywhere under `apps/api-gateway/src/vendor-intel/`**, and the only
web importer of the client calls neither ([[vendor-prices]] §10). The producer is built and
has no trigger.

## §5 Data

Read from `vendor-intel/vendor-comparison.service.ts` and `vendor-page-extractor.service.ts`:
`vendor_price_observations`, `vendor_catalogue`, `master_wine_library`.

`vendor_price_observations` is the table this software exists to read. **Three files in the
repo touch it**: `vendor-comparison.service.ts:254` (the manual POST this page exposes),
`vendor-page-extractor.service.ts:309` (the untriggered scrape), and
`analytics/engine/vendor-price-consensus.ts:51`, which only reads. No invoice-ingest path,
no catalogue import, no email extraction writes it.

[[vendor-portal]] is designed to feed it as an `api_catalog` observation rather than a
`website_scrape` (`VendorPortal.tsx:40-48`) — but nothing writes the portal's own tables
either, so that loop is closed at both ends.

## §6 Owner

[[supply-discovery-charter]] — team `supply-discovery`, department `product-vision`,
division Product (`01-org/product/product-vision/teams/supply-discovery/`). It claims this
surface by name: *"The comparison surface's product definition — `/vendor-prices`,
`/distributors`, `/providers`"* (`supply-discovery-charter.md:33-35`), and it owns
**freshness policy** — *"how old a price may be before it is shown as stale, hidden, or
refetched. A price is a perishable fact and this team owns its shelf life"* (`:31-33`). Its
evidence table lists `apps/api-gateway/src/vendor-intel/` as its extraction area
(`:88`).

The charter's stated failure mode is *"coverage and staleness, not approval quality"*
(`supply-discovery-charter.md:41`) — which is precisely the verdict below, arrived at
independently.

Contested with [[procurement-vendor-network-charter]], whose boundary table claims
`vendor-intel` (4 routes) as code it owns
(`procurement-vendor-network-charter.md:38`). The two claims are at different layers —
product definition vs. route ownership — and neither charter says so. Recorded, not resolved.

## §7 Maturity & seams

**hollow** — inherited unchanged from [[vendor-prices]] §10, and it is the cleanest example
of hollow in the repo, because the *code* is good.

The page renders a six-source provenance taxonomy — invoice / catalogue / quote / rep
message / social / manual (`VendorPriceCompare.tsx:28-44`) — implying six streams feed the
ladder. **One of them can produce data today, and it is the one that requires a human to
type a number into a page nobody can navigate to.**

Where it is honest it is exemplary and should be preserved: a null trend renders
"No comparable data" rather than `0%`, and the server's error message is shown verbatim
instead of axios's generic text (`VendorPriceCompare.tsx:100-110,466`).

Seams:

1. **Producer built, trigger missing.** The scrape/sweep pair is real code behind two
   routes nothing calls, with no cron (§4). This is a wiring gap, not a build gap.
2. **Dead-end in the page graph.** No inbound link, no outbound link. The page cannot be
   found and leads nowhere (§2).
3. **Two-layer ownership with no written line** (§6).
4. **Wine-only.** TIER-MAP S08's food path is scaffolding; the comparison would recommend
   the wrong vendor for food today ([[vendor-prices]] §9, OD-51).

## §8 Where it's going

- ADR 0049 §3a: **Vendor** division, phase **E1** (`04-specs/ECOSYSTEM-PLAN.md:55` lists
  `vendor-intel` and the `vendor-prices` page).
- The two highest-leverage fixes are both one-liners in size and structural in effect:
  a link from [[vendor-directory]], and a schedule on `POST /vendor-intel/sweep`.
- OD-51 (zero of 17 Pro tiers ship complete) names S08 price drift as one of the two
  closest, and wine-only as the reason it is not there.
- Freshness policy is unwritten. [[supply-discovery-charter]] owns it and no ADR records it —
  until it exists, "as of when" is unanswerable on every row this page renders.
