---
type: contract
title: Page Contract
status: proposed
updated: 2026-08-26
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
| 0 | **Surface** *(added 2026-08-25, ADR 0018)* | First section under the H1, always. The page's buttons, one line each: `- **Label** → [[dest-slug]] \`/route\``, or `(modal on this page)`, or `API \`POST /api/v1/…\``, or `external \`https://…\``. Max ~12 bullets, page-body only — global sidebar/topbar chrome is excluded so the graph shows real flows, not chrome. A page with no outbound navigation writes exactly `- (no outbound navigation — dead-end page)`. Outbound page wikilinks are mirrored into frontmatter `links:`. **This section is what the Obsidian graph renders** — 115 page→page edges as of 2026-08-25 |
| 1 | **Purpose** | What the page is for, in the user's words — and which user (owner / staff / guest / dev) |
| 1a | **Features** | What the page presents to the user, one bullet per capability, in plain product language ("see the shopping list", "chat with the vendor") — the founder-readable layer (mandated 2026-08-26). No `path:line` needed; broken or dark features are marked, never omitted. Redirects/placeholders write *none*. Improve these as pages evolve |
| 2 | **Entry** | How people reach it: nav link, deep link, redirect, cold URL. Cite [PAGE_MAP](../foundation/PAGE_MAP.md) — 24 routes have no inbound link; say so if this is one |
| 3 | **Files** | Component file + the co-located tree that renders it (`path:line` for the route binding in `App.tsx`) |
| 4 | **Endpoints** | Every API call the page makes — method, path, auth. Grep the component tree; cite [ENDPOINTS](../foundation/ENDPOINTS.md) rows |
| 5 | **Signals** | What the page emits or should emit — NF events, tracking, `uxSignals`. **Most pages emit nothing today; say so honestly** |
| 6 | **Tier cut** | Core / Plus / Pro per [TIER-MAP](../03-scenarios/TIER-MAP.md); which scenarios (`S..`) touch this page |
| 7 | **Rebrand surface** | Every user-visible `WineOps`/`wineops` string on this page (`path:line`) — the per-page slice of the 351-line brand debt |
| 8 | **State & config** | Feature flags, env vars, per-restaurant toggles that change what renders |
| 9 | **Gaps** | Dead sections, unreachable states, known defects — link `v3.0-TECH-DEBT.md` items rather than restating |

## The dossier — §10–§13, added 2026-08-25 (founder-approved)

§1–§9 describe what a page **is**. §10–§13 describe what it **does, needs, and
should become** — the vertical slice beneath each route, so the graph shows
page ↔ endpoint ↔ service and every page carries its own build plan.

| § | Section | Holds |
|---|---|---|
| 10 | **Maturity** | One verdict, first line, no hedging: **complete** (does what it claims, end to end) · **partial** (works, but a named capability is absent) · **hollow** (renders, but the data or action behind it is fake, mocked, or never persists) · **broken** (a primary path fails today). Then the evidence that decided it, with `path:line`. **Hollow is the important one** — a page that looks finished and lies is worse than one that is obviously unfinished, and this repo has shipped several |
| 11 | **Data flow** | Three tables. **Calls out:** every endpoint — method, path, auth posture, the gateway controller (`file:line`), and what it returns. **Fed by:** what puts that data there — webhooks, `@Cron` sweeps, Python agents, POS ingestion, manual entry. **Writes:** what the page changes, and what downstream reacts (queues, notifications, ledgers). A page whose data has no producer is a finding — say so |
| 12 | **Design intent** | What the page *should* be, distinct from what it is. Purpose in one line; the four states it must handle honestly — **empty / loading / error / permission-denied** — and which are actually implemented; the interaction pattern it belongs to; and where the current UI misleads (fabricated zeros, success toasts for writes that did not land, controls with no effect). Cite what exists; propose only what the page's own purpose implies |
| 13 | **Roadmap** | An ordered list for THIS page: what to build next, each one line, most valuable first, each traceable to a gap in §9–§12. Mark anything blocked and name the blocker (an OD, a missing endpoint, a founder decision). This is the per-page half of the build plan; the milestone half lives in [ROADMAP](../ROADMAP.md) |

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
maturity: complete | partial | hollow | broken   # §10 verdict, 2026-08-25
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
