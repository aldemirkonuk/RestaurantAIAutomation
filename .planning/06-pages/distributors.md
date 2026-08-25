---
type: page
route: /distributors
slug: distributors
component: none (inline <Navigate> redirect)
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[providers]]"]
---

# /distributors — legacy redirect → /providers?tab=discover

## Surface — buttons → where they go

- **(immediate redirect, no UI)** → [[providers]] `/providers?tab=discover`

## 1. Purpose
Compatibility route only. Distributor discovery moved into Providers as its
**discover** tab; this path survives "so existing links and bookmarks land in the
right place" (comment at `App.tsx:269-270`).

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
