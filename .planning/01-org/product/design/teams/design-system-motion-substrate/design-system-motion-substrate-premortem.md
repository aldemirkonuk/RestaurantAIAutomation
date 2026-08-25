---
type: premortem
division: product
department: design
team: design-system-motion-substrate
status: provisional
metrics: [design.system_composition_pct, design.token_source_count, design.primitive_documented_ratio, design.bespoke_components_added, design.a11y_violations_per_pr]
updated: 2026-08-24
links: ["[[design-system-motion-substrate-charter]]", "[[design-system-motion-substrate-loops]]", "[[design-system-motion-substrate-directive]]", "[[design-premortem]]", "[[ux-path-burn-down-charter]]", "[[exploration-studio-charter]]", "[[engineering-charter]]", "[[red-team-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[UX_PATHS_CATALOG]]"]
---

# Design System & Motion Substrate — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

The department's premortem line: *the system documents what already exists rather than
constraining what comes next; §X accessibility stays a catalogue section instead of a lint
rule, and every burn-down sprint adds one more bespoke component nobody can find.*
Expanded into five mechanisms.

---

### M1 — It became a museum

The most natural first quarter: write stories for the 18 undocumented primitives in
`apps/web/src/components/ui/`, stand up Storybook, publish it, declare the system built.
`design.primitive_documented_ratio` goes from 5/18 to 18/18. It looks like a complete
success.

And nothing about the *next* component changes. `packages/ui` still has zero stories,
because it is the shared package and therefore the scariest thing to touch.
`apps/mobile/src/design/tokens.ts` survives as a second token source, because unifying it
is a migration and migrations are not design work. Twelve months on, the system is an
accurate museum of what shipped in 2026 and a tax on everything shipped in 2027.

**Earliest observable signal.** `design.primitive_documented_ratio` rising while
`design.system_composition_pct` is still **undefined**. Documentation moving before the
forward metric even has a denominator is the tell, and it will look like progress on every
board that shows only the first number.

**Counter-pressure.** The primary metric is forward-looking by charter, and the ordering is
fixed in [[design-system-motion-substrate-directive]]: **one enforcement ships before the
first Storybook page.** Not both, not documentation-first — enforcement first, because a
constraint changes the next component and a story does not. The most obvious candidate is
already enumerated: §X `NEW-667…676` (`UX_PATHS_CATALOG.md:1493`) as a lint rule plus an
axe check.

---

### M2 — Two token sources became permanent, and the metric became decorative

`design.token_source_count` reads **2**. Getting to **1** means changing
`apps/mobile/src/design/tokens.ts` — a migration touching a shipped app, with no visible
user benefit and real regression risk. Every quarter there is something more urgent.

The metric stays on the board reading 2 forever. Its presence implies it is being worked;
its constancy proves it is not. Meanwhile web and native drift apart one hex value at a
time, and by the time anyone measures the divergence, unifying them is no longer a
migration but a redesign.

**Earliest observable signal.** `design.token_source_count` still **2** at the end of the
first quarter with no migration plan filed. Second signal, earlier and sharper: the first
color or spacing value that exists in one token source and not the other — divergence
precedes entrenchment.

**Counter-pressure.** [[design-system-motion-substrate-directive]] escalates at one quarter:
either a migration budget exists, or **the metric is removed from the board**. A decorative
metric is worse than no metric, because it launders inaction as tracking. Interim
mitigation with a real close-time: a **drift check** — a monthly diff of the two sources
that publishes divergent values by name, so the cost of postponing is a growing list rather
than a stable number.

---

### M3 — §X stayed prose, and accessibility became whatever the deadline allowed

Ten well-specified paths, `NEW-667…NEW-676`. They read as a standard. They are enforced by
nothing. The department deliberately declined to create a separate a11y team on the
argument that *a standard enforced in CI beats a team overruled by every deadline* — but
that argument only holds if the enforcement actually ships. If it does not, the department
has neither the team nor the standard, and has argued itself out of both.

**Earliest observable signal.** The first PR merged with a focus-ring or Escape-behaviour
regression and no CI complaint. Since nothing checks today, this signal is currently
**invisible** — which is itself the finding, and the reason `design.a11y_violations_per_pr`
is listed as *unmeasured* rather than as zero.

**Counter-pressure.** §X converts to enforcement **in the first quarter, or it leaves the
charter**. A standard nobody can fail is not a standard, and carrying it as prose lets the
department claim coverage it does not have. Reduced-motion is the highest-value single rule
to land first — it is the one §X item that intersects the motion work, and shipping motion
without it makes every later gesture a defect.

---

### M4 — The burn-down out-ran the substrate, one component at a time

[[ux-path-burn-down-charter]] is measured on rows closed. A row needs a component that does
not exist. Waiting for a primitive costs a sprint; writing a bespoke component costs an
afternoon. The rational local choice is bespoke, every single time, and no individual
instance is unreasonable.

Fifty afternoons later there are fifty components nobody can find, three of which do the
same thing with different focus behaviour. The system's coverage number is unchanged
because the bespoke components were never counted against it — they are not in the system,
so they are not in the denominator.

**Earliest observable signal.** The first component added under `apps/web/src/components/`
with no token reference and no story, merged without comment. Not the tenth — the **first**,
and it needs to be detectable mechanically because socially it is invisible.

**Counter-pressure.** A per-PR **design lint** ([[design-system-motion-substrate-schedule]])
that flags new components lacking a token reference or a story. And a directive rule with
a real cost attached: a row needing a new primitive stops here **first**
([[ux-path-burn-down-directive]]). The counterweight is that this team owes the burn-down a
close-time on primitive requests — if the answer takes longer than a sprint, bespoke wins
on merit and the rule deserves to be broken.

---

### M5 — The motion language stayed a beautiful set of unshipped specs

Sketches 043–046 are the most detailed design work in the repository: nine named motions,
each with trigger, motion, haptic, and an explicit **anti-gimmick** clause. Sketch 042
already picked the stack (*H — RN Skia + Reanimated*).

**All four motion sketches carry `Winner: null`.** So the depth is real and the decision is
absent. The failure completes quietly: the specs are admired, cited in reviews, never
implemented, and eighteen months later the stack decision has aged out from under them. The
anti-gimmick clauses — the most valuable part, because they are the part that says *when
not to animate* — are the first thing lost when someone eventually ships motion in a hurry.

**Earliest observable signal.** A shipped animation anywhere in `apps/mobile` that is not
traceable to a named motion in 043–046. That means motion is being invented at the point of
use, which is precisely what a motion language exists to prevent.

**Counter-pressure.** Convergence is forced by [[exploration-studio-charter]]'s
two-close-time rule: pick winners for 043–046, or withdraw the questions and record that
this product has no signature motion language. **Both outcomes are acceptable; the null is
not.** And the first motion implemented must be one that carries a reduced-motion path from
§X, so the standard and the language ship together rather than in the wrong order.

---

## Cross-cutting counter-pressure

- **Judge this team on other teams' work.** Its own output is never the measure. If a board
  shows `design.primitive_documented_ratio` without `design.system_composition_pct` beside
  it, M1 is already underway.
- **Silent compounding is this team's signature risk.** A burn-down mistake shows up on one
  screen; a substrate mistake shows up on 51 routes and two apps six months later. That is
  why its loops (`L-DSS-*`) run monthly with published deltas rather than on request.
- **The turnover constraint applies to primitives too** ([[AGENT_NATIVE_UI_DECISION]]:87-95).
  A "better" button that moves during service is worse than the current one. Anti-gimmick
  clauses in 043–046 are already written in this spirit; keep them.
- **[[red-team-charter]] should attack M2 and M3 hardest.** Both are the kind of item that
  stays on a board reading the same number for a year while everyone assumes someone is
  working on it.
