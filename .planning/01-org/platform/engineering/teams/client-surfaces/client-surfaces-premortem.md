---
type: premortem
division: platform
department: engineering
team: client-surfaces
status: provisional
metrics: [surfaces.reachable_route_ratio, surfaces.untraceable_route_components]
updated: 2026-08-24
links: ["[[client-surfaces-charter]]", "[[client-surfaces-loops]]", "[[client-surfaces-directive]]", "[[engineering-premortem]]", "[[design-charter]]", "[[red-team-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# Client Surfaces — Premortem

> Written at founding, before success is assumed.

The seed (`.planning/foundation/teams/technology.md:207-209`): *the 760-path UX catalogue
becomes the team's whole identity, it burns down paths on pages nobody reaches, and the 24
orphan routes are still orphaned a year later because burning down a list feels like
progress.*

## It is 2027-08. This team has failed. What happened?

### M1 — The burn-down became the job

`.planning/07-reference/UX_PATHS_CATALOG.md` is 154KB and 760 paths. It is the most *legible* work
available: paths close, a counter rises, every week produces a number that went the right
way. Roughly 90–100 paths were already closed before the team existed. Nothing about that
work is wrong — it is simply not the metric. Twelve months on, the counter reads 400/760,
the team feels productive, and `surfaces.reachable_route_ratio` is exactly where it
started: 24 orphan routes, 13 untraceable components.

**Earliest observable signal.** Three consecutive close-times where the burn-down count
moves and the reachable-route ratio does not. Also, earlier and cheaper: a status update
that leads with the burn-down number. What a team reports first is what it optimises.

**Counter-pressure.** The primary metric is the reachable-route ratio, stated in the
charter and repeated on the board; the catalogue is an **input**, never a substitute.
Both numbers appear side by side in [[client-surfaces-agenda-board]], and
[[engineering-premortem]] M5 makes this a department-level watch item so the team is not
policing its own temptation. If only one number moves for three close-times, the
department reallocates.

---

### M2 — The baseline was a snapshot and never became a measurement

The 24 orphans and 13 untraceable components come from a one-time analysis in
[[README]] §0. There is no job that recomputes them. The team can fix ten orphans and have
no way to show it, or ship fifteen new ones and have no way to know. In the absence of a
running number, "reachable-route ratio" is a phrase in a charter, and the burn-down (M1)
is the only number that exists — which is *why* M1 wins.

**Earliest observable signal.** The first PR that adds a route, merged without the orphan
count being recomputed. This is checkable immediately: if adding a route cannot change a
number, no number exists.

**Counter-pressure.** A static link-graph job over `apps/web/src/pages/` and the router
config, run in CI, emitting orphan count and untraceable-component count on every PR.
`.planning/foundation/PAGE_MAP.md` already records the navigation graph, so the input
exists — this is a script, not a research project. **Ship it before any orphan is fixed**,
because otherwise the fixes are unverifiable.

---

### M3 — "Reachable" was satisfied with a link nobody uses

The metric is "routes with at least one inbound in-app link". That is a graph property,
and graph properties are gameable in the most innocent way imaginable: add the orphan to a
footer, a settings list, a debug menu. The count goes to zero orphans. The route is still
functionally invisible — reachable from a link no user will encounter in the flow where
they need it. The team has satisfied the metric and not the mandate, honestly and without
anyone intending to cheat.

**Earliest observable signal.** Orphan count falling faster than navigation work is
actually happening — specifically, orphans resolved by links added to a single hub page or
a catch-all index. Watch *where* the new inbound links come from, not just that they exist.

**Counter-pressure.** The ratio is reported alongside **link provenance**: which page the
inbound link lives on, and whether that page is itself on a primary flow. A route reachable
only from a debug or index page is recorded as **semi-orphaned**, a third category — not
folded into "reachable". Whether a route belongs in a flow at all is [[design-charter]]'s
call; this team's job is to make the current state visible, not to invent navigation.

---

### M4 — Mobile stayed one team's afterthought until it wasn't

The single-team decision is correct today: `apps/mobile/app/` is roughly eight route files
and a separate mobile team would have no load (`technology.md:190-192`). The decision has
no **re-evaluation trigger**. Mobile grows — a guest-facing surface, an operator app — and
because the surfaces team is measured on web routes, mobile receives whatever attention is
left. The right structural call at founding becomes the wrong one silently, which is the
characteristic failure of a correct decision with no expiry.

**Earliest observable signal.** Mobile route count passing a stated threshold, or a
close-time in which mobile received no commits while web received many. Both are countable
from the repository, so the trigger can be automatic.

**Counter-pressure.** Write the re-evaluation trigger into the charter now, while the
answer is obviously "one team": when `apps/mobile/app/` exceeds a stated route count, or
when mobile carries a guest-facing surface, the split is reconsidered as a department
decision. Track mobile's metrics **separately** even under one team, so the imbalance is
visible before it is structural.

---

### M5 — Comprehension was never tested, only rendering

The charter says the correctness criterion is **comprehension, not data integrity**. But
comprehension has no assertion. 34 web test files and 4 Storybook stories — thin, and named
as thin in the evidence — test that components render. A year of green tests, and the
actual failure is an operator who cannot tell whether stock was counted, or who misreads a
low-stock alert as a reorder confirmation. The team has excellent render coverage and no
evidence about understanding.

**Earliest observable signal.** A support question or founder-relayed question of the form
"what does this screen mean?" — the first one, treated as a defect rather than as a
question. It is the only comprehension signal the team gets for free.

**Counter-pressure.** Comprehension failures are logged as **defects against a screen**,
with the screen named, and they route to [[design-charter]] for intent and back to this
team for implementation. Storybook coverage grows toward the states that are actually
confusing — empty, error, partial, stale — rather than toward component count. The seam
holds: Design owns what it should say, this team owns whether the built screen says it
(`technology.md:865`).

---

## What [[red-team-charter]] should attack first

M2, because it enables M1. A team with one legible number and one aspirational number will
optimise the legible one every time — that is not a character flaw, it is what measurement
does. Making the reachable-route ratio a real, recomputed number is the single change that
makes the rest of this premortem falsifiable.
