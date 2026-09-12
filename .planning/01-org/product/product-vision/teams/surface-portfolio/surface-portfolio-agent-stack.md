---
type: agent-stack
division: product
department: product-vision
team: surface-portfolio
status: designed
updated: 2026-08-27
metrics: [surface.unowned_surface_count, surface.untraceable_route_components, surface.routes_without_owning_module]
links: ["[[surface-portfolio-charter]]", "[[surface-portfolio-schedule]]", "[[surface-portfolio-loops]]", "[[surface-portfolio-premortem]]", "[[0034-agent-stack-artifact]]", "[[product-vision-agent-stack]]", "[[skills-charter]]", "[[PAGE_MAP]]", "[[ENDPOINTS]]"]
---

# Surface Portfolio — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> The department's only EXISTS team gets the card with the sharpest edge on it: its
> backlog is already enumerated, so an agent here has no excuse for an empty close-time —
> and no licence to let regeneration stand in for a verdict. Mechanisms stay elsewhere:
> harness → [[harness-runtime-charter]] (**OD-03 open**), skills → [[skills-charter]].

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `route-portfolio-auditor` | Regenerate the route map, **diff it against the verdict sheet**, and report every route that carries no verdict, no owning module, or a twin rendering the same component | NEW; every input it reads EXISTS |

## 2. Agent cards

```yaml
agent: route-portfolio-auditor
unit: surface-portfolio
triggers:
  - schedule: "monthly — regeneration + verdict diff, reconciliation, ask review"   # mirrored in [[surface-portfolio-schedule]]
  - schedule: "quarterly — cold-entry re-check, mobile-gap review"
  - topic: route.added                       # publisher: NONE (gap — only PR review notices a new <Route>, which is how 24 orphans accumulated)
consumes:
  - "apps/web/src/App.tsx — 51 routes, re-verified 2026-08-24 (charter §Evidence)"
  - "[[PAGE_MAP]]:5 (39 nav edges), :104-132 (24 cold entries), :151-167 (13 untraceable) — publisher: the regeneration job itself"
  - "[[ENDPOINTS]] — 448 endpoints across 44 modules, for the route ↔ module cross-check"
  - "the route verdict sheet — publisher: NONE (gap; it does not exist yet, see §5)"
emits:
  - "surface.unowned_surface_count decomposed into 5 buckets → [[product-vision-agent-stack|pv-orchestrator]]'s board row"
  - "kill / merge / make-reachable verdicts → [[client-surfaces-charter]] executes the code deletion"
  - "verdicts touching a deferred path → [[ux-path-burn-down-charter]] (premortem M3); PROD-F5 governs who may commission the unblock and stays open"
  - "the 13 untraceable asks, with owner and date → [[client-surfaces-charter]]"
  - "nf_a events (task_type: route_portfolio_audit)"
routing_class: mechanical      # parse, count, diff, cross-reference — the verdict itself is a human's, see below
quality_bar: "the diff is the deliverable, not the regenerated map (premortem M1); *unclassified* is reported and never absorbed; the headline is published as 5 buckets, never as one number (premortem M2)"
autonomy:
  read: autonomous
  propose: autonomous          # verdict candidates and asks land as PRs
  mutate_stock_money_outbound: confirm   # constant; this agent has no such surface
memory: surface-portfolio
escalates_to: "[[product-vision-charter]]; killing the last page of a live module escalates rather than resolving (charter §Non-goals)"
```

**The card's own hard rule.** This agent **never deletes a route and never signs a verdict.**
It proposes classifications with evidence; a human signs, with the catalogue cross-reference
attached ([[surface-portfolio-schedule]] §Deliberately not proposed). Automating the kill
would make [[surface-portfolio-directive]]'s cross-reference rule optional in practice.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `route-portfolio-verdict` | T2 | Monthly, or when `apps/web/src/App.tsx` changes | Every route carries exactly one verdict and a named owning module; new routes since the last run are listed by name; *unclassified* is reported | The 24 orphan routes and 13 untraceable components have sat unowned since the 2026-08-24 scan (foundation [[README]]:65, [[PAGE_MAP]]:104-132, :151-167); nothing notices a new orphan being created | NEW |
| `route-map-regen` | T3 | Monthly, or on `App.tsx` change | Regenerates [[PAGE_MAP]] **and emits the diff** against the previous run, not just the new document | [[PAGE_MAP]] is already a generated grep-target (CLAUDE.md §2 lists it as regenerated, not hand-edited); the diff is the half that was never built | NEW |
| `route-module-reconcile` | T3 | Monthly | Two lists — pages with no module, modules with no page — each entry naming its counterpart evidence in [[ENDPOINTS]] | `/authorize/:integrationId` is simultaneously cold-entry ([[PAGE_MAP]]:110) and untraceable (:155) while its `integrations/` module carries 5 well-guarded endpoints: capability with an orphaned surface, found by hand | NEW |
| `duplicate-route-detect` | T3 | On `App.tsx` change | Any two routes resolving to the same component are reported with both paths | `/wine-agent` and `/wineagent` both render the same inline `PlaceholderPage` (`apps/web/src/App.tsx:293-294`, `:349`) and shipped that way unnoticed | NEW |

Consumed, owned elsewhere: path-level burn-down ([[ux-path-burn-down-charter]]); endpoint
auth classification ([[security-charter]]); the skill envelope ([[skills-charter]]).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue, §3.3 gate still applying.
- **Episodic** — nf_a `task_type: route_portfolio_audit` for audit runs only. The charter
  claims **no neural-footprint tie** and this stack does not invent one: route work produces
  no agent or guest decision traces, and asserting an `nf_*` tie here would be padding.
- **Semantic** — `memory/` beside this file, index `surface-portfolio-MEMORY.md`. Its first
  three facts are already established and would otherwise be re-derived every month: the
  24+13 overlap is **26 distinct routes, 11 doubly-unknown** (not 37 problems); the three
  live duplication pairs; which cold entries are *intentionally* cold (`/v/:slug`,
  `/invite/:code`, `/login`, `/register`) and when each re-check is due. `source`,
  `confidence`, `last_verified` per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and the current verdict
  sheet. [[PAGE_MAP]] and [[ENDPOINTS]] are retrieval targets by line range, never preloaded.

**Consolidation** — monthly, mirrored in [[surface-portfolio-schedule]]: diff this month's
verdicts against last month's facts, **failures first** — a route that lost its owner, or a
cold-entry re-check that slipped past its date, becomes a fact naming the mechanism; expire
facts unverified for 90 days; propose skill candidates. One PR; "no delta" is stated when
true, and three "no delta" runs in a row are [[surface-portfolio-premortem]] M1, not a quiet
success.

## 5. Async contract

Board rows, verdict PRs, asks with named owners, NF-A events; loops with close_times in
[[surface-portfolio-loops]]. Gap rows:

| Gap | Why it is a gap |
|---|---|
| The verdict sheet does not exist yet | The agent's primary `consumes` has no publisher: the first run has nothing to diff against and must **create** the baseline, then diff from run two onward |
| `route.added` has no publisher | Nothing emits on a new `<Route>`; the monthly cadence bounds the blind spot at one close-time, which is exactly how the current 24 accumulated |
| `apps/mobile` has no route inventory at all | The charter claims **web only** and says so out loud (premortem M5). A portfolio number that silently excludes half the surfaces is a flattering number, so the quarterly mobile-gap review exists to keep the exclusion visible |
| Untraceable asks are vault edits, not events | [[client-surfaces-charter]] is a named consumer, but nothing notifies it; past-due asks escalate to [[product-vision-charter]] instead of waiting |

## 6. Evidence today

- **EXISTS — everything the auditor reads.** 51 routes in `apps/web/src/App.tsx`; 39 nav
  edges, 24 cold entries, 13 untraceable components ([[PAGE_MAP]]:5, :104-132, :151-167);
  448 endpoints in 44 modules ([[ENDPOINTS]]); three verified duplication pairs.
- **NEW — the auditor, all four skills, and the verdict sheet.** The backlog is enumerated
  and unowned; enumerating it again is [[surface-portfolio-premortem]] M1.
- **NEW — the memory layer**, except the NF-A tables themselves (ADR 0006/0008, migrated).
