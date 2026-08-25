---
type: schedule
division: platform
department: engineering
team: client-surfaces
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[client-surfaces-charter]]", "[[client-surfaces-loops]]", "[[engineering-schedule]]", "[[design-charter]]", "[[skills-charter]]", "[[PAGE_MAP]]", "[[UX_PATHS_CATALOG]]"]
---

# Client Surfaces — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Link-graph pass over `apps/web/src/pages/` + router config — L-CS-1 | Reached / semi-orphaned / orphaned counts; untraceable components |
| Per PR | Route-added check — a new route with no inbound link is blocked at review | Blocking review comment |
| Per PR | Web test suite (34 test files) | Render and regression pass/fail |
| Weekly | Comprehension defect review — L-CS-3 | Defects against named screens; Design seam routing |
| Weekly | Surface health — L-CS-4 | Bundle size, render failures, a11y violations |
| Fortnightly | Burn-down vs reachability comparison — L-CS-2 | The two numbers, side by side, and nothing else |
| Monthly | Mobile load watch — L-CS-5 | `apps/mobile/app/` route count and commit share |
| Monthly | `.planning/foundation/PAGE_MAP.md` refresh against the live router | Navigation-graph drift |
| Quarterly | `packages/ui` component audit — `{charts,layout,notifications,primitives}` | Unused components; duplicated primitives |
| Quarterly | `.planning/UX_PATHS_CATALOG.md` reconciliation against the link graph | Closed paths sitting on unreachable pages |

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion.

**None built yet.** Proposed, each tied to a scheduled job above:

| Proposed skill | Fires on | Why a skill rather than a script |
|---|---|---|
| `route-reachability-audit` | Per PR, and on demand | The graph pass is a script; the judgement is classifying an inbound link as primary-flow vs index/footer/debug |
| `screen-implementation-diff` | A design-vs-built discrepancy report | Must decide which side of the Design seam a discrepancy sits on — and say so explicitly rather than fixing quietly |
| `edge-state-story-gap` | Quarterly, or on a component change | Identifies which components lack empty/error/partial/stale stories; 4 stories exist today and the evidence calls them thin |

**Constraint on all three:** no skill may **add navigation** to resolve an orphan. Whether
a route belongs in a flow is [[design-charter]]'s decision (`technology.md:865`); an
automated fixer that links orphans into a footer would satisfy the metric and defeat the
mandate — premortem M3 executed at machine speed.

Registry governance sits with [[skills-charter]] (Applied AI); this team authors and
retires its own skills within that registry.
