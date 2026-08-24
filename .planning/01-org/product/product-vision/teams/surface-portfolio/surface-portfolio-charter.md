---
type: charter
division: product
department: product-vision
team: surface-portfolio
status: exists
metrics: [surface.unowned_surface_count, surface.untraceable_route_components, surface.routes_without_owning_module]
updated: 2026-08-24
links: ["[[surface-portfolio-premortem]]", "[[surface-portfolio-agenda-full]]", "[[surface-portfolio-agenda-board]]", "[[surface-portfolio-directive]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-schedule]]", "[[product-vision-charter]]", "[[design-charter]]", "[[ux-path-burn-down-charter]]", "[[client-surfaces-charter]]", "[[ask-ai-charter]]", "[[supply-discovery-charter]]", "[[PAGE_MAP]]", "[[ENDPOINTS]]"]
---

# Surface Portfolio — Charter

Parent: [[product-vision-charter]] (Product division). Siblings:
[[inbound-understanding-charter]], [[service-floor-charter]],
[[supply-discovery-charter]], [[ask-ai-charter]].

## Mandate

Own the **route inventory as a portfolio**: which of the 51 web routes should exist, which
module owns each, and which get killed, merged, or made reachable. The deliverable is a
**verdict per route** — not a count, not a regenerated map. The count is a by-product of
the verdicts.

## Boundaries

Owns outright:

- **The route verdict sheet** — every route classified as *keep* / *merge* / *kill* /
  *make-reachable* / *intentionally-cold*, each with a named owning module.
- **Duplication calls** — two routes rendering the same thing is a product decision, not a
  design decision.
- **Reachability** — a page nobody can navigate to is either dead or undiscoverable, and
  deciding which is this team's job.
- **Route ↔ module reconciliation** — cross-checking 51 routes against 448 endpoints in 44
  modules ([[ENDPOINTS]]). A module with routes and no page, or a page with no module, is
  this team's finding.

**Why this is distinct from [[design-charter]].** This team decides **whether a page should
exist**; Design decides **what is on it and how it behaves**. That split is not invented
here — foundation [[README]]:65 assigns the unlinked-route finding to Product & Vision by
name, while the UX catalogue and sketches sit with Design (`teams/product.md:182-186`).

**Why this is distinct from [[ux-path-burn-down-charter]].** That team owns rows *inside* a
page — 910 paths, each a behaviour. This team owns whether the page holding those rows
should exist at all. Burning down paths on a route that should be killed is the most
expensive kind of progress.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| What is on a page, its layout, its states | [[design-charter]] | Existence vs content |
| The 910-path UX catalogue as an execution ledger | [[ux-path-burn-down-charter]] | Route-level portfolio vs path-level burn-down |
| Deleting the code once a route is killed | [[client-surfaces-charter]] *(Platform)* | We issue the verdict; Engineering executes it |
| Endpoint auth classification | [[security-charter]] *(Intelligence)* / [[platform-api-charter]] | We notice a page with no module; they classify the routes behind it |
| Whether a *module* should exist | [[product-vision-charter]] | A route verdict is not a module verdict; killing the last page of a live module escalates |
| Native/mobile route inventory | [[client-surfaces-charter]] | ⚠️ Scope is **web today**. See the honest gap below |
| Onboarding/activation flow coherence | [[activation-in-product-guidance-charter]] *(Design)* | `/onboarding`, `/get-started`, `/help` exist and are linked; their *coherence* is Design's |

**An honest scope gap.** [[PAGE_MAP]] covers `apps/web` only — 51 routes, generated from
`apps/web/src/App.tsx`. `apps/mobile` has no equivalent inventory anywhere in the repo. This
charter claims **web**, and the mobile gap is named here rather than quietly implied,
because a portfolio team that silently excludes half the surfaces is reporting a flattering
number.

## Metrics it moves

**Primary — `surface.unowned_surface_count`** = (routes with no inbound in-app link **and**
no named owning module) + (untraceable route components).

**Today: 24 + 13.** This is the **only measured metric in the department**, which makes it
both the team's advantage and its trap ([[surface-portfolio-premortem]] M2).

**The target is a number the team commits to, not zero.** Some cold entries are correct:
`/v/:slug` is a deliberately crawlable vendor portal, `/invite/:code` is an emailed deep
link, `/login` and `/register` are unauthenticated entry points. Declaring those
*intentionally-cold* is a verdict, not an exemption — the difference is that a verdict is
written down and re-checked.

**Secondary — `surface.routes_without_owning_module`.** Cross-referenced against 448
endpoints in 44 modules. A page with no module behind it and a module with no page are
different findings with different owners, and neither is visible from the route list alone.

Neural-footprint tie: none claimed. This team's work does not produce agent or guest
decision traces, and asserting an `nf_*` tie here would be padding.

## Evidence today

**EXISTS — the backlog is already enumerated, which is rare.**

- **51 routes, 39 in-app navigation edges** ([[PAGE_MAP]]:5). Route count re-verified this
  session directly against `apps/web/src/App.tsx` — **51**.
- **24 routes with no inbound in-app link** ([[PAGE_MAP]]:104-132): `/admin/health`,
  `/authorize/:integrationId`, `/calendar-classic`, `/communications`, `/credits`,
  `/dev-sandbox`, `/distributors`, `/documents-reports`, `/inventory-legacy`, `/logs`,
  `/notifications`, `/promotions`, `/receipts`, `/services`, `/simpos/:restaurantId`,
  `/simpos/:restaurantId/orders`, `/studio`, `/studio/certify`, `/studio/queue`, `/team`,
  `/v/:slug`, `/vendor-prices`, `/wine-agent`, `/wineagent`.
- **13 route components could not be traced** ([[PAGE_MAP]]:151-167) — `*`,
  `/authorize/:integrationId`, `/credits`, `/distributors`, `/receiving/:orderId/door`,
  `/services`, `/simpos/:restaurantId`, `/simpos/:restaurantId/orders`, `/studio`,
  `/studio/certify`, `/studio/queue`, `/wine-agent`, `/wineagent`. Navigation *out* of these
  pages is not represented in the graph at all, so the 39-edge figure is a floor, not a
  count.
- **Three live duplications needing a product call, not a design call:**
  - `/wine-agent` **and** `/wineagent` — verified this session, both render the same inline
    placeholder (`apps/web/src/App.tsx:293-294`, `PlaceholderPage` defined at `:349`)
  - `/inventory` vs `/inventory-legacy` ([[PAGE_MAP]]:25-26)
  - `/calendar` vs `/calendar-classic` ([[PAGE_MAP]]:20-21)
- **Cross-check surface:** 448 endpoints across 44 modules ([[ENDPOINTS]]).
- ⚠️ **11 of the 24 cold entries are also untraceable** — they appear on both lists. The
  headline "24 + 13" is therefore not 37 distinct problems; it is **26 distinct routes**,
  11 of which are doubly-unknown. That overlap is not stated in [[PAGE_MAP]] and is the
  first correction this team should carry back.

## Entry condition

**Active now, first in the department activation order** ([[product-vision-agenda-full]]).
It is the only EXISTS team, its backlog is enumerated, and its first three verdicts need no
engineering permission to decide.
