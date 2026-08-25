---
type: charter
division: platform
department: engineering
team: client-surfaces
status: exists
metrics: [surfaces.reachable_route_ratio, surfaces.untraceable_route_components]
updated: 2026-08-24
links: ["[[engineering-charter]]", "[[client-surfaces-premortem]]", "[[client-surfaces-agenda-full]]", "[[client-surfaces-agenda-board]]", "[[client-surfaces-directive]]", "[[client-surfaces-loops]]", "[[client-surfaces-schedule]]", "[[client-surfaces-charter|eng-client-surfaces]]", "[[design-charter]]", "[[platform-api-charter]]", "[[PAGE_MAP]]", "[[UX_PATHS_CATALOG]]"]
---

# Client Surfaces — Charter

Division **Platform** → Department [[engineering-charter]] → Team `client-surfaces`
(§2.5 of `.planning/foundation/teams/technology.md:183-209`).

## Mandate

`apps/web` (Vite SPA, 51 routes), `apps/mobile` (Expo Router), and the shared
`packages/ui` component layer. **Implementation quality, route reachability,
accessibility, bundle health.** This team owns whether the built screen matches the
intended one, renders, performs, and can be reached.

## Boundaries

Owns outright:

- **`apps/web`** — `apps/web/src/pages/` holds 40 page components plus 11 sub-route
  directories; the navigation graph is recorded in `.planning/foundation/PAGE_MAP.md`.
- **`apps/mobile`** — `apps/mobile/app/`: `(tabs)`, `wine-agent.tsx`, `get-started.tsx`,
  `lock.tsx`, and siblings.
- **`packages/ui`** — `packages/ui/src/components/{charts,layout,notifications,primitives}`.
- **Front-end test and story coverage** — 34 web test files; `apps/web/src/stories/`
  (4 Storybook stories — **thin**, and named as thin in the evidence).
- **The UX path corpus as an input** — `.planning/UX_PATHS_CATALOG.md` (154KB).

**Deliberately one team, not two.** `apps/mobile/app/` is roughly eight route files;
splitting web and mobile now would create a mobile team with no load
(`technology.md:190-192`).

## Distinct from siblings because

It owns **the only artifacts a human looks at**, and its correctness criterion is
**comprehension, not data integrity** (`technology.md:189-190`). Every other Engineering
team can define correct as "the number matches". Here a screen can be entirely correct by
every data test and still fail, because nobody understood it or nobody could get to it.

**Distinct from [[design-charter]] (Product division)** because Design decides *what the
screen should be*; this team owns whether the built screen matches, renders, and performs
(`technology.md:194-195`; seam at `technology.md:865`).

## Explicit non-goals

| Not ours | Whose it is |
|---|---|
| What a screen should be, its information architecture, its intent | [[design-charter]] *(Product)* |
| Whether the data on the screen is correct | [[inventory-ledger-charter]], [[catalogue-identity-charter]], [[procurement-vendor-network-charter]] |
| Auth on the endpoints the surfaces call | [[platform-api-charter]] |
| Whether a notification should appear at all | [[messaging-delivery-charter]] delivers it; [[design-charter]] decides it belongs |
| Agent-facing UX policy — when a human must confirm | [[action-safety-the-human-gate-charter|action-safety-the-human-gate]] |
| CDN, hosting, deploy pipeline | [[release-engineering-charter|sre-release-engineering]] |

## Metrics it moves

**Primary: `surfaces.reachable_route_ratio`** — routes with at least one inbound in-app
link. The opening baseline is recorded in [[README]] §0 and transcribed at
`technology.md:203-206`: **24 routes with no inbound link, and 13 route components
untraceable**.

Secondary: `surfaces.untraceable_route_components` — the 13. These are a different problem
from the 24: an orphan route exists and cannot be reached; an untraceable component may
not correspond to a route at all.

**Explicitly not the primary metric:** paths burned down from
`.planning/UX_PATHS_CATALOG.md`. That number is an input. Treating it as the goal is the
premortem ([[client-surfaces-premortem]] M1).

## Evidence today

**EXISTS** (`.planning/foundation/teams/technology.md:197-201`).

- `apps/web/src/pages/` — 40 page components + 11 sub-route directories
- `.planning/foundation/PAGE_MAP.md` — the navigation graph, recorded
- `apps/mobile/app/` — `(tabs)`, `wine-agent.tsx`, `get-started.tsx`, `lock.tsx`, …
- `packages/ui/src/components/{charts,layout,notifications,primitives}`
- `apps/web/src/stories/` — 4 Storybook stories (**thin**)
- 34 web test files
- `.planning/UX_PATHS_CATALOG.md` — 154KB burn-down corpus

**Correction this team owns.** `apps/web` is a **Vite SPA with `react-router-dom`**
(`apps/web/package.json:8,55,94`), **not Next.js as CLAUDE.md §1 states**
(`technology.md:37-40`). Fixing that claim is cheap and is this team's, because everything
downstream — routing assumptions, rendering assumptions, bundle strategy — inherits it.

**Baseline honesty.** The reachable-route ratio has a *baseline* (24 orphans, 13
untraceable) but no *running measurement*. The number came from a one-time analysis in
[[README]] §0, not from a job. Turning it into a repeated reading is this team's first
task — see [[client-surfaces-agenda-full]].
