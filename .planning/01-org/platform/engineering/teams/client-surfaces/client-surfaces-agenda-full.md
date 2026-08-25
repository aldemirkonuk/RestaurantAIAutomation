---
type: agenda-full
division: platform
department: engineering
team: client-surfaces
status: provisional
metrics: [surfaces.reachable_route_ratio, surfaces.untraceable_route_components]
updated: 2026-08-24
links: ["[[client-surfaces-charter]]", "[[client-surfaces-premortem]]", "[[client-surfaces-agenda-board]]", "[[client-surfaces-loops]]", "[[engineering-agenda-full]]", "[[design-charter]]", "[[PAGE_MAP]]", "[[UX_PATHS_CATALOG]]"]
---

# Client Surfaces — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Make reachability a **running number** before fixing anything it measures, then keep the
burn-down in its place as an input. In order:

1. **A link-graph job in CI.** Emits orphan-route count and untraceable-component count on
   every PR. `.planning/foundation/PAGE_MAP.md` already records the navigation graph, so
   the input exists; this is a script, not research.
2. **Link provenance in the report** — a third category, *semi-orphaned*, for routes
   reachable only from a debug page, a footer, or a catch-all index (premortem M3).
3. **Correct the stack claim.** `apps/web` is a Vite SPA with `react-router-dom`
   (`apps/web/package.json:8,55,94`), not Next.js as CLAUDE.md §1 says.
4. **A mobile split trigger, written now** while the answer is obviously "one team".
5. **Storybook coverage toward confusing states** — empty, error, partial, stale — rather
   than toward component count. 4 stories today, named as thin in the evidence.

## How

**Measure before fixing.** Premortem M2 is the enabling failure: without a recomputed
number, orphan fixes are unverifiable and the burn-down is the only number that exists —
which is exactly why the burn-down wins (M1). The job ships first.

**Two numbers on the board, always.** Reachable-route ratio *and* paths burned down. The
catalogue is an input; if only the burn-down moves for three close-times, the department
reallocates ([[engineering-premortem]] M5). This is deliberately not left to the team's own
discipline — it is a department watch item.

**Provenance, not just presence.** "At least one inbound link" is satisfiable by adding
every orphan to a footer. Report *where* the link lives and whether that page is on a
primary flow. Whether a route belongs in a flow at all is [[design-charter]]'s call; this
team makes the current state visible rather than inventing navigation.

**Comprehension failures are defects.** They have a screen name, they route to
[[design-charter]] for intent and back here for implementation. The first "what does this
screen mean?" is a defect, not a question (premortem M5).

## Why now

- **The baseline is already known and already bad**: 24 routes with no inbound link, 13
  route components untraceable ([[README]] §0). Known-and-unmeasured is the worst state —
  it invites the belief that it is handled.
- **The burn-down is already running.** Roughly 90–100 of 760 paths are closed. The
  gravitational pull described in M1 has already started; the counter-pressure is cheapest
  to install before the habit sets.
- **A wrong stack claim in CLAUDE.md propagates.** Every future session reading "Next.js"
  makes routing and rendering assumptions that do not hold for a Vite SPA.

## Next steps

- [ ] Ship the link-graph CI job; publish orphan and untraceable counts per PR (M2)
- [ ] Add the *semi-orphaned* category with link provenance (M3)
- [ ] Publish reachable-route ratio and burn-down count side by side (M1)
- [ ] Correct CLAUDE.md §1: Vite SPA + `react-router-dom`, not Next.js
- [ ] Write the mobile-split re-evaluation trigger into the charter (M4)
- [ ] Track mobile route health separately under the single team (M4)
- [ ] Grow `apps/web/src/stories/` toward empty / error / partial / stale states (M5)
- [ ] Open a comprehension-defect channel with [[design-charter]] — named screen, named seam
- [ ] Reconcile `.planning/UX_PATHS_CATALOG.md` paths against the link graph, so closed
      paths on unreachable pages are visible as such

## Questions for the founder

1. **What is a route allowed to be reachable *from*?** If a footer link counts, the metric
   is satisfiable trivially (M3). Proposal: primary-flow links count fully, index/footer/
   debug links count as semi-orphaned. Accept?
2. **Are the 24 orphans meant to exist?** Some may be deliberately unlinked — deep links,
   email targets, in-progress work. The team can only fix orphans that are *accidents*.
   Which are which, and who decides — [[design-charter]] or the founder?
3. **Mobile split trigger.** What route count, or what event, should re-open the one-team
   decision? Writing it now costs nothing; writing it later means M4 already happened.
4. **Is comprehension testable at this stage?** Real usability testing needs users. Until
   then the only signal is relayed operator confusion. Is that channel available, and does
   it reach this team?
5. **Does the UX catalogue keep its priority?** It is 154KB of real analysis and the
   department is explicitly deprioritising it relative to reachability. Confirm — this is
   a reversal of the effort's current direction.
