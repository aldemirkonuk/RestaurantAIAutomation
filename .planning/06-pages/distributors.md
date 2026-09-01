---
type: page
route: /distributors
slug: distributors
softwares: [global-vendor-search]
component: none (inline <Navigate> redirect)
audience: owner
tier: core
archetype: redirect # proposed 2026-08-26 (OD-106)
signals_today: none
rebrand_strings: 0
maturity: complete
status: documented
updated: 2026-08-26
links: ["[[PAGE-CONTRACT]]", "[[providers]]"]
---

# /distributors — legacy redirect → /providers?tab=discover

> **Part of** [[08-softwares/global-vendor-search|Global Vendor Search]] — the small software this screen belongs to. Index: [[SOFTWARE-MAP]].

## Surface — buttons → where they go

- **(immediate redirect, no UI)** → [[providers]] `/providers?tab=discover`

## 1. Purpose
Compatibility route only. Distributor discovery moved into Providers as its
**discover** tab; this path survives "so existing links and bookmarks land in the
right place" (comment at `App.tsx:269-270`).

## 1a. Features
none — redirect. Distributor discovery lives on [[providers]] §1a (discover tab).

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list). Old bookmarks/external links
only. PAGE_MAP also lists it under "unresolved route components" — correct, there is
no component.

## 3. Files
- Route: `apps/web/src/App.tsx:271-274` —
  `<Navigate to="/providers?tab=discover" replace />`
- The page it *used* to be still exists as code: `pages/distributors/index.tsx`
  re-exports `pages/distributors/command/DistributorMapPage.tsx`, now rendered inside
  Providers (`Providers.tsx:150-151,661`) — see [[providers]] §3.

## 4. Endpoints
none from this route. (The destination's discover tab calls
`GET /distributors/search|facets|:id` — documented in [[providers]] §4.)

## 5. Signals
none.

## 6. Tier cut
n/a — redirect. Scenario coverage lives with [[providers]] (S13).

## 7. Rebrand surface
none.

## 8. State & config
none. `replace` semantics: the redirect does not pollute history.

## 9. Gaps
- `pages/distributors/useDistributorsPage.ts` still exports a full standalone page
  hook (`RADIUS_STOPS`, bbox state) consumed only through Providers — if the discover
  tab ever diverges, this indirection is where drift will hide. No debt-register entry.

## 10. Maturity

**complete.** The route's entire contract is "send old links to the right place", and it
does exactly that.

| Evidence | `path:line` |
|---|---|
| One `<Navigate to="/providers?tab=discover" replace />`, no component, no data, no state. | `apps/web/src/App.tsx:271-274` |
| The destination honours the param — `?tab=discover\|mine` drives the tab. | `pages/Providers.tsx:229-237` |
| `replace` semantics mean Back does not bounce the user into a redirect loop. | `App.tsx:273` |

Nothing here can be hollow: there is no UI to render convincingly and no write to fail.

## 11. Data flow

### Calls out

| Method · Path | Auth | Gateway controller | Returns |
|---|---|---|---|
| *(none)* | — | — | the route unmounts before any effect runs |

The discover experience's own calls (`GET /distributors/search`, `/facets`, `/:id` →
`distributor-discovery.controller.ts:39,64,89`, class-guarded with `JwtAuthGuard` at
`:35`) belong to [[providers]] §11.

### Fed by

*none* — a redirect has no data. The catalogue behind the destination is seeded
(`supabase/migrations/seed/27_vendor_catalogue_seed.sql`) and queried through the
`search_distributors` RPC (`distributor-discovery.service.ts:84`); see [[providers]] §11.

### Writes

*none.*

## 12. Design intent

**Should be:** invisible. A user who followed a bookmark should land on the distributor
map without noticing the route moved.

| State | Handled? | Notes |
|---|---|---|
| empty | n/a | no content |
| loading | n/a | synchronous redirect, no flash |
| error | n/a | cannot fail |
| permission-denied | ✅ inherited — the destination sits inside `DashboardLayout`'s auth gate, and `/distributors/*` is guarded server-side anyway (`distributor-discovery.controller.ts:35`) |

**Where the UI misleads: nowhere.** The one caveat is documentation, not behaviour:
`PAGE_MAP` lists this route under "unresolved route components", which is correct but
reads as a defect in the index.

## 13. Roadmap

1. **Do nothing to this route.** It is finished. The only future action is deletion, and
   only once bookmark traffic is known to be zero — which nothing currently measures
   (§5: no signals anywhere).
2. Resolve the indirection in `pages/distributors/useDistributorsPage.ts` (§9) — either
   inline it into the discover tab or keep it deliberately as a seam. *Blocker: it is a
   judgement call about whether discover ever becomes its own route again; no ADR exists.*
3. Annotate the `PAGE_MAP` "unresolved route components" list so redirect routes are
   distinguished from genuinely broken bindings — a docs fix that belongs there, not here.
