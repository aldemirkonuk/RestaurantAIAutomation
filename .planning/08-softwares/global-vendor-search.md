---
type: software
slug: global-vendor-search
name: Global Vendor Search
division: vendor
status: partial
tier: core
routes: ["/providers?tab=discover", "/distributors"]
pages: [providers, distributors]
api_modules: [distributor-discovery]
agents: []
owner_unit: supply-discovery
updated: 2026-09-01
links: ["[[providers]]", "[[distributors]]", "[[supply-discovery-charter]]", "[[SOFTWARE-MAP]]"]
---

# Global Vendor Search

## §0 What it is

The way a restaurant finds a supplier it does not already work with. You open a map of
distributors who deliver to your area, narrow it down by what they carry and where they
serve, and open one to see what it would mean to buy from them. Everything about vendors
you *already* use lives next door in [[vendor-directory]]; this is the outward-looking
half — the reason a kitchen would meet somebody new.

## §1 Features today

- See the distributors that serve your address, on a map
- Filter the map by product category, service territory, and portfolio facets
- Open one distributor and read its profile — what it carries, where it delivers
- Search across the vendor catalogue rather than only your own vendor list
- Add a discovered distributor to your own vendors — *dark* (no write path from discovery
  into `providers`; the hand-off is manual today)

## §2 Screens

- [[providers]] — hosts this software on its `?tab=discover` tab
  (`apps/web/src/pages/Providers.tsx:150-151` lazy-loads `DistributorMapPage`, rendered at
  `:661`). The same page's `mine` tab is a **different software** ([[vendor-directory]]).
- [[distributors]] — the original route, now a redirect
  (`apps/web/src/App.tsx:301-302` → `/providers?tab=discover`). The page note is kept
  because the redirect is the documented entry point.

Component tree: `apps/web/src/pages/distributors/command/DistributorMapPage.tsx` plus
`DistributorMap` / `DistributorDrawer` / `mapCamera` / `useDistributorsPage.ts`.
The route is behind `PageGate` (`App.tsx:293`), so the legacy and the p3 `ProvidersNext`
surface can differ — check the flag before trusting a screenshot.

## §3 Backend

`apps/api-gateway/src/distributor-discovery/` — a clean single-domain module, one of the
few in the gateway that is not a grab-bag.

| Endpoint | Controller |
|---|---|
| `GET /distributors/search` | `distributor-discovery.controller.ts:39` |
| `GET /distributors/facets` | `distributor-discovery.controller.ts:64` |
| `GET /distributors/:id` | `distributor-discovery.controller.ts:89` |

`@Controller("distributors")` at `distributor-discovery.controller.ts:34`. Query
construction is isolated in `distributor-query.ts` and is the only part with real unit
tests (`distributor-query.spec.ts`). Web client: `apps/web/src/services/api/distributors.ts`.

## §4 Automation

`none` — every search is user-initiated. Nothing refreshes coverage on a schedule, which
is exactly the failure mode the owning charter names (below).

## §5 Data

Read from `apps/api-gateway/src/distributor-discovery/distributor-discovery.service.ts`:
`vendor_catalogue`, `vendor_locations`, `vendor_portfolio_facets`,
`vendor_service_territories`, and `restaurants` (for the searching restaurant's address).
It **owns none of them** — the catalogue is written by [[vendor-price-compare]] and the
corpora lanes. A discovery product that owns no data is coverage-dependent by construction.

## §6 Owner

[[supply-discovery-charter]] — team `supply-discovery`, department `product-vision`,
division Product (`01-org/product/product-vision/teams/supply-discovery/`).
The charter states the failure mode precisely: *"Its failure mode is coverage and
staleness, not approval quality"* (`supply-discovery-charter.md:41`) — i.e. this software
is judged on whether the map has the right distributors in it, not on how well it ranks them.

## §7 Maturity & seams

**partial.** The search, facets, and detail paths work end to end against real tables; the
loop back into procurement does not exist, so a distributor you find cannot become a
distributor you order from without leaving the product.

Seams:
1. **One page, two softwares.** `Providers.tsx` (1,484 LOC) hosts this and
   [[vendor-directory]] behind a `?tab=` param. Neither can be extracted without the other.
2. **Vendors are spread over five gateway modules** — `providers`, `distributor-discovery`,
   `vendor-intel`, `vendor-catalogue`, `vendor-portal` — and four web API clients. This
   module is the clean one; the boundary around it is not.
3. **No producer for freshness.** Nothing sweeps the catalogue; staleness is invisible
   in the UI.

## §8 Where it's going

- ADR 0049 §3a puts this under the **Vendor** division, phase **E1** (cross-runtime send
  reliability) — discovery itself is not in an E-phase, which is worth noticing.
- The dark "add to my vendors" path is the single highest-value gap: it closes
  discovery → directory → order.
- Coverage instrumentation (how many distributors serve a given tenant, how stale) is
  unbuilt and is the metric the owning charter implies.
