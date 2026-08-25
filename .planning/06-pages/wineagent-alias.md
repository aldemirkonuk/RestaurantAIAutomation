---
type: page
route: /wineagent
slug: wineagent-alias
component: apps/web/src/App.tsx (inline PlaceholderPage)
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[wine-agent]]", "[[sommelier]]"]
---

# /wineagent — Wine Agent (alias route; the one nav actually uses)

## Surface — buttons → where they go

- (no outbound navigation — dead-end page)

## 1. Purpose
Duplicate of [[wine-agent]] — same inline placeholder, second spelling. This is the
variant real users can reach, because the sidebar links here.

## 2. Entry
**Sidebar "Wine Agent" item links to `/wineagent`**
(`apps/web/src/components/layout/Sidebar.tsx:159`, in `aiNavItems`, rendered at
`Sidebar.tsx:578`). PAGE_MAP's entry-point list claims `/wineagent` has no inbound
link (`.planning/foundation/PAGE_MAP.md`) — **that is stale**; the graph could not
trace data-array nav items (PAGE_MAP's own "unresolved route components" caveat).
Note the other "Wine Agent" launchers (Help card `Help.tsx:174-176`, FAB
`guidance/components/WineAgentFab.tsx:37-39`) deliberately bypass this route and go
to `/sommelier`.

## 3. Files
- Route: `apps/web/src/App.tsx:294` → `<PlaceholderPage title="Wine Agent" />`
- Component: inline `PlaceholderPage`, `apps/web/src/App.tsx:349-370`

## 4. Endpoints
none.

## 5. Signals
none.

## 6. Tier cut
Not a deliverable in any tier — placeholder. No S.. scenario touches it.

## 7. Rebrand surface
none.

## 8. State & config
none.

## 9. Gaps
- **A first-class sidebar item lands on a 🚧 placeholder.** Sidebar promises
  "Hands-off agent for routine inventory and ordering work" (`Sidebar.tsx:161`) and
  delivers "under construction" (`App.tsx:362-365`) — the only nav item in the app
  that dead-ends.
- Duplicate of `/wine-agent` (`App.tsx:293`); pick one canonical spelling and redirect
  the other (see [[wine-agent]] §9).
