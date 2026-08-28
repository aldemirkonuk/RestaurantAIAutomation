---
type: agent-stack
division: platform
department: engineering
team: client-surfaces
status: designed
updated: 2026-08-27
metrics: [surfaces.reachable_route_ratio, surfaces.untraceable_route_components]
links: ["[[client-surfaces-charter]]", "[[client-surfaces-schedule]]", "[[client-surfaces-loops]]", "[[client-surfaces-directive]]", "[[0034-agent-stack-artifact]]", "[[engineering-agent-stack]]", "[[skills-charter]]", "[[design-charter]]", "[[PAGE_MAP]]"]
---

# Client Surfaces — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's correctness criterion is comprehension, not data integrity
> ([[client-surfaces-charter]] §Distinct from siblings), which makes its card unusual in one
> way: the agent may measure reachability and may never *fix* it. Whether a route belongs in a
> flow is [[design-charter]]'s call, so an agent that linked orphans into a footer would move
> the metric and defeat the mandate. Mechanism references are [[engineering-agent-stack]]'s.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `surface-reachability-auditor` | Turn the one-time 24-orphan / 13-untraceable baseline into a repeated reading, classify every inbound link, and add none | NEW |

One row. Bundle health, a11y and comprehension defects are all read off the same link-and-render
pass; a second agent would be a second census of the same 51 routes.

## 2. Agent cards

```yaml
agent: surface-reachability-auditor
unit: client-surfaces
triggers:
  - topic: pr.opened                      # publisher: GitHub PR events (L-CS-1 runs per PR)
  - schedule: "weekly — surface health (L-CS-4)"       # mirrored in [[client-surfaces-schedule]]
  - schedule: "monthly — PAGE_MAP refresh against the live router"
consumes:
  - "apps/web/src/pages/ (40 page components + 11 sub-route directories) and the react-router config"
  - "apps/mobile/app/ route files (publisher: the repo)"
  - "[[PAGE_MAP]] — .planning/foundation/PAGE_MAP.md, the recorded navigation graph"
  - "the 34 web test files' results (publisher: .github/workflows/ci.yml)"
emits:
  - "surfaces.reachable_route_ratio and surfaces.untraceable_route_components → [[client-surfaces-agenda-board]] and L-ENG-1 (consumer: [[engineering-agent-stack|eng-board-keeper]])"
  - "a blocking review comment on a new route with no inbound link (consumer: the PR author)"
  - "design-seam discrepancies (consumer: [[design-charter]], as a written question — never a fix)"
  - "nf_a events (task_type: route_reachability_audit) — consumer: NONE (gap, see §5)"
routing_class: judgment          # the graph walk is mechanical; classifying an inbound link as primary-flow vs index/footer/debug is not ([[client-surfaces-schedule]])
quality_bar: "NONE (gap) — no verdict basis exists for a reachability reading (ADR 0017 has no such grader). The standing check is reproducibility: a rerun on the same commit yields the same two numbers and the same per-route classification."
autonomy:
  read: autonomous
  propose: autonomous            # findings land as PR comments and board rows
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: client-surfaces
escalates_to: "[[engineering-charter]]"
```

**The card's own hard rule:** the auditor **never adds navigation**. Linking an orphan into a
footer satisfies `surfaces.reachable_route_ratio` and destroys what it measures — premortem M3
executed at machine speed ([[client-surfaces-schedule]] §Skills owned). It reports the orphan
and names the flow question for [[design-charter]].

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `route-reachability-audit` | T2 | Per PR, and on demand | Every route in `apps/web` and `apps/mobile` is classified reached / semi-orphaned / orphaned **with the link it was reached by**; the two numbers reproduce on a rerun of the same commit | The baseline itself was derived by hand in the 2026-08-24 evidence pass — 24 routes with no inbound link, 13 untraceable route components ([[README]] §0, transcribed at `technology.md:203-206`) — and has not been re-derived since | NEW |
| `stack-claim-audit` | T2 | A planning doc, CLAUDE.md, or a plan asserts a framework fact about `apps/web` or `apps/mobile` | Every stack claim in the named doc cites `apps/web/package.json` at `path:line` or is corrected in the same PR | Performed and closed: CLAUDE.md §1 asserted Next.js; `apps/web/package.json:8,55,94` says Vite + `react-router-dom`. Found in the 2026-08-24 evidence pass (`technology.md:37-40`) and now corrected — `CLAUDE.md:41` reads "Vite SPA + react-router-dom (**not** Next.js)" | NEW |

`screen-implementation-diff` and `edge-state-story-gap` appear in [[client-surfaces-schedule]]
and are **deliberately not rows here**: no design-vs-built discrepancy has been adjudicated and
no story-coverage sweep has been run, so neither has a past instance to cite.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]); screen intent
([[design-charter]]); the auth on the endpoints these surfaces call ([[platform-api-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates from consolidation go to
  [[skill-harvesting-charter]]'s queue through the §3.3 gate.
- **Episodic** — nf_a `task_type: route_reachability_audit`. Needs `context.route` and
  `context.classification` as jsonb keys, plus `context.surface` (web / mobile / ui), so "when
  did this route stop being reachable?" is a filter over history rather than a re-walk of every
  past commit.
- **Semantic** — `memory/` beside this file, `client-surfaces-MEMORY.md` as index. Its founding
  facts: the 24/13 baseline and its date, the Vite-not-Next.js correction and that it has landed
  (so nobody re-litigates it), and the standing rule that burn-down count is an input and never
  the goal ([[client-surfaces-charter]] §Metrics). Provenance frontmatter per ADR 0034; every
  write is a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and §Metrics. `PAGE_MAP.md` is
  loaded per run because it *is* the working set; `.planning/07-reference/UX_PATHS_CATALOG.md`
  (154KB) is a grep-and-excerpt target only, never loaded (CLAUDE.md §2).

**Consolidation** — monthly, mirrored in [[client-surfaces-schedule]]: diff this month's route
classification against last month's facts; failures first — a route that moved from reached to
orphaned becomes a fact naming the mechanism (the link was removed, the nav was restructured,
the component was renamed), never "the ratio dropped"; expire facts unverified for 90 days;
propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops in [[client-surfaces-loops]], NF-A events, vault PRs, and skill
candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `surfaces.reachable_route_ratio` has a baseline and no producer | The 24/13 numbers came from a one-time analysis, not a job ([[client-surfaces-charter]] §Evidence). Until the per-PR pass runs, this agent's first honest output is `unreadable` on the department board |
| The Design seam has no channel | Discrepancies are written questions in [[client-surfaces-agenda-full]]; nothing notifies [[design-charter]], whose schedule must poll. Acceptable async path, unowned close_time |
| `route_reachability_audit` NF-A events have no declared consumer | Beyond this team's own board row; recorded rather than assumed |
| Mobile has no independent reading | `apps/mobile/app/` is roughly eight route files and is deliberately not its own team (`technology.md:190-192`); the monthly mobile load watch is the only thing that would notice that changing |

## 6. Evidence today

- **EXISTS — the surfaces themselves.** `apps/web/src/pages/` (40 components + 11 sub-route
  directories), `apps/mobile/app/`, `packages/ui/src/components/{charts,layout,notifications,primitives}`,
  34 web test files, and `PAGE_MAP.md` as a recorded graph — all cited in
  [[client-surfaces-charter]] §Evidence.
- **PARTIAL — the corpus and the stories.** `.planning/07-reference/UX_PATHS_CATALOG.md` exists
  and is an input, not a target; `apps/web/src/stories/` holds 4 Storybook stories and the
  evidence calls them thin, which is why `edge-state-story-gap` has no instance to cite yet.
- **NEW — `surface-reachability-auditor` and both skills.** No job measures reachability today.
- **Closed since the charter was written:** the Vite-not-Next.js correction the charter assigns
  to this team has landed in `CLAUDE.md:41`. The charter text still describes it as outstanding;
  that is a charter edit for this team, not for this doc.
