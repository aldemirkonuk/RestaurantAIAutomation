---
type: contract
title: Page Contract
status: proposed
updated: 2026-08-24
links: ["[[PAGE_MAP]]", "[[SCENARIO-CONTRACT]]", "[[TIER-MAP]]", "[[AGENDA]]"]
---

# Page Contract — one document per route

> The ecosystem layer the founder asked for: files, configuration, and tracking for every
> page. [PAGE_MAP](../foundation/PAGE_MAP.md) knows the 51 routes exist; nothing documents
> what each page *is*. This contract fixes the shape so 51 documents written in parallel
> are the same document.

## Anatomy — 9 sections per page

| § | Section | Holds |
|---|---|---|
| 1 | **Purpose** | What the page is for, in the user's words — and which user (owner / staff / guest / dev) |
| 2 | **Entry** | How people reach it: nav link, deep link, redirect, cold URL. Cite [PAGE_MAP](../foundation/PAGE_MAP.md) — 24 routes have no inbound link; say so if this is one |
| 3 | **Files** | Component file + the co-located tree that renders it (`path:line` for the route binding in `App.tsx`) |
| 4 | **Endpoints** | Every API call the page makes — method, path, auth. Grep the component tree; cite [ENDPOINTS](../foundation/ENDPOINTS.md) rows |
| 5 | **Signals** | What the page emits or should emit — NF events, tracking, `uxSignals`. **Most pages emit nothing today; say so honestly** |
| 6 | **Tier cut** | Core / Plus / Pro per [TIER-MAP](../03-scenarios/TIER-MAP.md); which scenarios (`S..`) touch this page |
| 7 | **Rebrand surface** | Every user-visible `WineOps`/`wineops` string on this page (`path:line`) — the per-page slice of the 351-line brand debt |
| 8 | **State & config** | Feature flags, env vars, per-restaurant toggles that change what renders |
| 9 | **Gaps** | Dead sections, unreachable states, known defects — link `v3.0-TECH-DEBT.md` items rather than restating |

## Frontmatter

```yaml
type: page
route: /orders
slug: orders
component: apps/web/src/pages/Orders.tsx
audience: owner | staff | guest | dev | public
tier: core | plus | pro | public
signals_today: none | partial | instrumented
rebrand_strings: 0        # count of user-visible WineOps strings on this page
status: documented
updated: 2026-08-24
links: []
```

## Rules

- **Evidence or absence.** Every endpoint and file claim carries `path:line`. If a section
  is empty, write *none* — an empty §5 is a finding, not a formatting failure.
- **No restating.** §4 cites the atlas; §9 links the debt register. Pages change weekly;
  duplicated detail rots.
- **`signals_today` is the ecosystem metric.** The founder's tracking mandate lands here:
  the index counts instrumented pages, and that number is currently ~0.
- Files: `.planning/06-pages/<slug>.md`, slug from the route (`/wine-library` → `wine-library.md`,
  `/simpos/:restaurantId` → `simpos-terminal.md`).

Index: [[PAGES-MAP]] (Dataview over `type: page`).
