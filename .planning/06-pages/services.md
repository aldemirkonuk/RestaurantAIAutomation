---
type: page
route: /services
slug: services
component: none (inline <Navigate> redirect)
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-24
links: ["[[PAGE-CONTRACT]]", "[[help]]"]
---

# /services — redirect → /settings?tab=services

## 1. Purpose
Compatibility route. "Services & permissions" (email, web, and privacy access grants)
lives as a Settings tab; this path exists so the old standalone URL keeps working.

## 2. Entry
No inbound in-app link (`PAGE_MAP.md` entry-point list) — the surfaces that send users
to services (Help's "Manage services" button, `Help.tsx:154`; Privacy's controls list,
`Privacy.tsx:64-66`) navigate straight to `/settings?tab=services`, skipping this
route. Cold URL/bookmarks only.

## 3. Files
- Route: `apps/web/src/App.tsx:295` — `<Navigate to="/settings?tab=services" replace />`
- No component (PAGE_MAP "unresolved route components" — correct)

## 4. Endpoints
none from this route. The destination tab's calls belong to the `/settings` page doc.

## 5. Signals
none. (Arrivals via Help's button are counted by `trackGuidance('services_visited')`,
`Help.tsx:153` — but those bypass this route; see [[help]] §5.)

## 6. Tier cut
n/a — redirect. Consent/permissions gating matters to every tier equally.

## 7. Rebrand surface
none.

## 8. State & config
none.

## 9. Gaps
none beyond redirect-forever debt: nothing links here, so the route can be retired the
day analytics could prove zero cold hits — which is exactly the telemetry the app does
not have (§5 across the page corpus).
