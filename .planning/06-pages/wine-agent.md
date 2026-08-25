---
type: page
route: /wine-agent
slug: wine-agent
component: apps/web/src/App.tsx (inline PlaceholderPage)
audience: owner
tier: core
signals_today: none
rebrand_strings: 0
status: documented
updated: 2026-08-25
links: ["[[PAGE-CONTRACT]]", "[[wineagent-alias]]", "[[sommelier]]"]
---

# /wine-agent — Wine Agent (placeholder)

## Surface — buttons → where they go

- (no outbound navigation — dead-end page)

## 1. Purpose
Intended home of the hands-off inventory/ordering agent. Today it renders a generic
"under construction" placeholder — the page has no product function.

## 2. Entry
**No inbound in-app link** (`.planning/foundation/PAGE_MAP.md` entry-point list — and
unlike its alias, nothing in `Sidebar.tsx` points here). Cold URL only. The two UI
surfaces that offer "Wine Agent" both route to `/sommelier` instead: the Help card
(`apps/web/src/pages/Help.tsx:174-176`) and the floating FAB
(`apps/web/src/guidance/components/WineAgentFab.tsx:37-39`).

## 3. Files
- Route: `apps/web/src/App.tsx:293` → `<PlaceholderPage title="Wine Agent" />`
- Component: inline `PlaceholderPage` function, `apps/web/src/App.tsx:349-370` (no
  dedicated file — PAGE_MAP lists it under "unresolved route components")

## 4. Endpoints
none.

## 5. Signals
none.

## 6. Tier cut
Not a subscriber deliverable in any tier — placeholder. No scenario in
[TIER-MAP](../03-scenarios/TIER-MAP.md) routes through it.

## 7. Rebrand surface
none. Visible copy is "Wine Agent" + "This page is under construction…"
(`App.tsx:362-365`) — no `WineOps` string.

## 8. State & config
none.

## 9. Gaps
- **Duplicate route**: `/wine-agent` and `/wineagent` (`App.tsx:293-294`) render the
  identical placeholder. Nav uses **`/wineagent`** (`Sidebar.tsx:159`); this hyphenated
  variant is reachable only by typed URL. One of the two should be a redirect.
- The real "Wine Agent" behaviour lives at `/sommelier`; every launcher already skips
  this page. Until the agent ships, this route only exists to disappoint a typed URL.
