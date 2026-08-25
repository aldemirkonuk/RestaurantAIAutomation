---
type: charter
division: product
department: product-vision
team: supply-discovery
status: partial
metrics: [supply.sku_dual_price_coverage_pct, supply.price_freshness_p50_days, supply.needed_sku_denominator_size]
updated: 2026-08-24
links: ["[[supply-discovery-premortem]]", "[[supply-discovery-agenda-full]]", "[[supply-discovery-agenda-board]]", "[[supply-discovery-directive]]", "[[supply-discovery-loops]]", "[[supply-discovery-schedule]]", "[[product-vision-charter]]", "[[supplier-distributor-network-charter]]", "[[inbound-understanding-charter]]", "[[surface-portfolio-charter]]", "[[PAGE_MAP]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# Supply Discovery (Vendor Finder) — Charter

Parent: [[product-vision-charter]] (Product division). Siblings:
[[inbound-understanding-charter]], [[service-floor-charter]],
[[surface-portfolio-charter]], [[ask-ai-charter]].

## Mandate

Define **Vendor Finder**: given what a restaurant needs, find the distributors who carry it,
extract their catalogue and prices, and make the comparison usable. The deliverable is the
**supply graph** — which distributor carries which SKU at what price, as of when — and the
definition of when that graph is good enough to trust.

## Boundaries

Owns outright:

- **The discovery contract** — what a "needed SKU" is, what counts as a match between a
  restaurant's need and a distributor's line, and what confidence a match must carry before
  it appears in a comparison.
- **Extraction quality for external catalogues** — the standard, not the crawler code.
- **Freshness policy** — how old a price may be before it is shown as stale, hidden, or
  refetched. A price is a perishable fact and this team owns its shelf life.
- **The comparison surface's product definition** — `/vendor-prices`, `/distributors`,
  `/providers` ([[PAGE_MAP]]:36-37,56), jointly with [[surface-portfolio-charter]] on
  whether they should exist in that shape at all.

**Why this is not [[inbound-understanding-charter]].** It is the only named module that goes
**outbound**. Inbound processes what arrives; this crawls, extracts, and *constructs* the
graph the rest of procurement depends on. Its failure mode is **coverage and staleness**,
not approval quality, and its quality bar is set by an **external corpus** rather than by a
restaurant's own documents (`teams/product.md:145-150`).

## Explicit non-goals — read this with the boundary below

| Not ours | Whose it is | The line |
|---|---|---|
| **Vendor relationships, terms, portal logins** | [[supplier-distributor-network-charter]] *(Partnerships)* | We ship the software that **finds** vendors; they **sign and maintain** them |
| Crawler and extractor implementation | [[engineering-charter]] *(Platform)* | We set the extraction standard and the freshness policy; they write the code |
| Wine identity resolution as a domain problem | [[catalogue-identity-charter]] *(Platform)* | `vendor-intel/wine-identity.ts` matches a vendor line to *our* catalogue; the catalogue's own identity rules are not ours |
| Reading an invoice that already arrived | [[inbound-understanding-charter]] | Outbound vs inbound is the whole distinction |
| Whether `/distributors` and `/vendor-prices` should be cold-entry pages | [[surface-portfolio-charter]] | Both are currently unreachable in-app ([[PAGE_MAP]]:116,130) — a route verdict, not a feature |
| Legal/ToS exposure of crawling a third party | [[legal-charter]] *(Corporate)* / [[compliance-privacy-charter]] | We name the targets; they say whether we may |

**⚠️ The boundary that is genuinely at risk.** `teams/product.md:828` names
**Supply Discovery + [[supplier-distributor-network-charter]]** as the *single most likely
duplication in this division*. Both cite `apps/api-gateway/src/distributor-discovery/`. One
person will hold both at v0. The distinction is real — *finding* a vendor and *signing* one
have different metrics (catalogue coverage vs live feeds) — but it is a fork the founder
should close explicitly rather than let two charters assert past each other. Filed as a
department fork (`teams/product.md` §6, needs renumbering — the proposed ID is taken).

## Metrics it moves

**Primary — `supply.sku_dual_price_coverage_pct`**: percentage of a restaurant's *needed*
SKUs matched to at least **two** live distributor prices. Two, not one: a single price is a
quote, two prices are a comparison, and comparison is the product.

**Paired guard — `supply.price_freshness_p50_days`**: median age of the prices behind that
coverage. Coverage with stale prices is worse than no coverage, because it is confidently
wrong at the moment a purchase decision is made.

**Entry metric — `supply.needed_sku_denominator_size`.** Coverage is a fraction, and this
team currently has **no denominator**. "Needed SKU" is undefined for every restaurant in the
system. Until that is defined for at least one, coverage is not zero — it is *undefined*,
and reporting it as a percentage would be fiction.

**Deliberately not a metric:** distributors crawled, pages extracted, or SKUs in the
database. Every one of those can rise while the product gets no better, and they are the
exact proxies [[product-vision-directive]] forbids.

## Evidence today

**PARTIAL — substantial, and more than the docs credit.**

| Area | Path | Note |
|---|---|---|
| Discovery | `apps/api-gateway/src/distributor-discovery/` | controller, service, module, `distributor-query.ts`, dto — and **3 spec files** (`distributor-discovery.controller.spec.ts`, `distributor-discovery.service.spec.ts`, `distributor-query.spec.ts`) |
| Extraction | `apps/api-gateway/src/vendor-intel/` | `vendor-page-extractor.service.ts`, `vendor-page-extraction.ts` + spec, `vendor-comparison.service.ts` + spec, `wine-identity.ts` + spec, controller, module, dto |
| Prospects | `apps/api-gateway/src/common/orchestrator/prospects.service.ts` / `prospects.controller.ts` | |
| Catalogue | `apps/api-gateway/src/vendor-catalogue/` | |
| Surfaces | `/distributors`, `/vendor-prices` (`VendorPriceCompare`), `/providers` | [[PAGE_MAP]]:36-37,56 |
| Architecture | `.planning/PROSPECTS_ATTRIBUTION_ARCHITECTURE.md` | |

**Verified this session:** `vendor-intel/` contains 10 files including three spec files, and
`distributor-discovery/` contains 8 including three specs. This is one of the better-tested
areas in the department.

**⚠️ Reality check, and it is the whole premortem.** The consumer of this supply graph has
almost no volume: `procurement_orders` = **1** and `pos_checks` = **0**
([[AGENT_NATIVE_UI_DECISION]] §2). Two of the three surfaces this team's output lands on are
**cold-entry with no inbound in-app link** — `/distributors` ([[PAGE_MAP]]:116) and
`/vendor-prices` (:130) — meaning a user cannot navigate to the comparison by clicking. The
code is real; the demand pulling on it is not yet.

## Entry condition

Active, but **scoped narrowly**. Fourth in the department activation order
([[product-vision-agenda-full]]). Its entry work is defining "needed SKU" for **one**
restaurant so the primary metric acquires a denominator — not crawling another distributor.
