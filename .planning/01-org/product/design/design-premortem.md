---
type: premortem
division: product
department: design
status: provisional
metrics: [design.paths_closed_per_month, design.ledger_drift_days, design.token_source_count, design.time_to_first_real_action_staff_min, design.resolved_question_rate]
updated: 2026-08-24
links: ["[[design-charter]]", "[[design-loops]]", "[[design-directive]]", "[[ux-path-burn-down-premortem]]", "[[design-system-motion-substrate-premortem]]", "[[exploration-studio-premortem]]", "[[activation-in-product-guidance-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[AGENT_NATIVE_UI_DECISION]]", "[[UX_PATHS_CATALOG]]"]
---

# Design — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. Design has failed. What happened?

Five mechanisms, most likely first. Three of them are **already in progress** — the
evidence for M1 and M3 is in the repo today, which is what makes this document a
diagnosis rather than a forecast.

---

### M1 — The ledger drifted against itself and nobody noticed for a year

This one has already started. `UX_PATHS_CATALOG.md:49` says the Seating Density widget
*"does not exist yet"*; `:1013` says it shipped; `SeatingDensityPanel.tsx` is on disk and
was last touched 2026-07-27. The log's own rule at `:15` — *"Update both places when a
deferred item ships"* — is written down and was not followed.

Extrapolate that forward twelve months. A 910-row ledger accumulates a second, third,
tenth false blocker. Planning sessions read the log, believe rows are blocked that are
not, and route work elsewhere. The catalogue's most valuable property — that every
deferred row names its unblocker — inverts: the unblockers are still named, they are just
**wrong**, and a confidently wrong dependency graph is worse than no dependency graph,
because people act on it.

**Earliest observable signal.** Any single deferred row whose stated blocker resolves
without the row's status changing within one close-time. Concretely and mechanically: a
weekly job that greps each "Unblocked by" cell in the `:10-67` table against the repo and
finds one hit. The signal exists **today**, unexamined — the count of stale rows has never
been taken.

**Counter-pressure.** `design.ledger_drift_days` is a first-class metric on
[[design-agenda-board]], and it is produced by a **script, not a habit**. The instruction
at `:15` failed precisely because it relied on a human remembering during a burn-down
session. Loop `L-DSN-1` in [[design-loops]] closes weekly and its only job is
*log-versus-disk reconciliation*. The Seating Density row is repaired as the first act of
the team's existence — not because it matters much, but because closing the known drift
before opening new work is the whole discipline.

---

### M2 — The department burned down the enumerable and left the important unowned

The 100 seating-density rows (`NEW-761…860`) are enumerated, sequential, individually
small, and produce a number that goes up. Roughly 70 of them are blocked on data that has
no table (`:64`) — but the other 30 are shippable, and shipping them feels like progress.

Twelve months later: more Reports surface nobody opens, `design.paths_closed_per_month`
looks healthy, and the paths that would have made `/inventory` usable during a Friday
service are still deferred. The catalogue rewards volume; the product needed judgement.
This is [[engineering-premortem]] M5 restated from the other side of the seam, and both
departments can fail it simultaneously while each looks productive.

**Earliest observable signal.** Three consecutive close-times where
`design.paths_closed_per_month` moves and **no path closed on a route a staff member
touches during service** (receiving, inventory, count). Track the second number
explicitly; it will not fall out of the first.

**Counter-pressure.** [[ux-path-burn-down-charter]]'s ordering rule is not
catalogue-order and not section-completeness: it is **frequency of use during service**,
which is derivable from [[PAGE_MAP]] in-degree plus the turnover constraint at
[[AGENT_NATIVE_UI_DECISION]]:87-95. A section may not be "completed" as a unit — that is
what makes 100 adjacent rows attractive and is exactly the trap. And the board carries
both numbers side by side, because a single burn-down count can rise for a year while the
product gets no easier to use at 4pm with a driver waiting.

---

### M3 — The Exploration Studio became a gallery

Also already in progress, and measurable: **28 of 43 manifest rows carry `Winner: null`**.
Two-thirds of the exploration never converged. Ten more sketch directories were never
indexed at all, and one manifest row (`039`) points at a directory that does not exist.

The failure completes like this: sketching is the most enjoyable work in the department
and the cheapest to start. Sketch count climbs to 80, `Winner: null` climbs with it, and
because no decision ever arrives, [[ux-path-burn-down-charter]] designs in production —
which is the thing sketching exists to prevent. The corpus becomes an argument for the
department's diligence and evidence of its ineffectiveness at the same time.

**Earliest observable signal.** A new sketch directory created while
`design.resolved_question_rate` is unchanged from the prior close-time. Not the fifth —
the **first**. Today's baseline is 15 of 43 indexed, and 43 of 53 indexed at all.

**Counter-pressure.** A hard WIP constraint enforced in [[exploration-studio-directive]]:
**no new sketch while more than N unresolved questions are open**, N set at the team's
first close-time and published. Plus a rule with teeth — a sketch that has carried
`Winner: null` for two close-times is **resolved by declaring "no winner, question
withdrawn"**, which is a legitimate and recorded outcome. Retiring a question is
convergence. Leaving it null is not.

---

### M4 — The design system documented what already existed instead of constraining what came next

The substrate team writes stories for the 18 undocumented primitives in
`apps/web/src/components/ui/`, publishes a Storybook, and declares the system built.
Nothing about the *next* component changes. `packages/ui` still has zero stories because
it is the shared package and therefore the scariest to touch. `apps/mobile/src/design/tokens.ts`
survives as a second token source because unifying it is a migration, not a design task.
Meanwhile every burn-down sprint adds one more bespoke component nobody can find, and §X
accessibility (`NEW-667…676`) stays a catalogue section rather than becoming a lint rule.

Twelve months on, the system is a museum of what shipped in 2026 and a tax on everything
shipped in 2027.

**Earliest observable signal.** The first PR that adds a component to
`apps/web/src/components/` **without** a token reference or a story, merged without
comment. Also: `design.token_source_count` still reading **2** at the end of the first
quarter.

**Counter-pressure.** The team's primary metric is deliberately *forward-looking* —
**% of newly-shipped surface composed from system primitives and tokens** — not
"% of existing primitives documented", which is the metric that produces a museum. And
the accessibility standard converts from prose to enforcement: §X becomes an ESLint rule
plus an axe check in CI, or it is dropped from the charter. A standard nobody can fail is
not a standard.

---

### M5 — Activation was designed for the owner demo, and staff never got past the tour

The owner sees the product in a sales context, motivated, unhurried, with a founder on the
call. The staff member sees it mid-service, unmotivated, with a manager who is annoyed the
software exists. Onboarding gets built for the first person because that is who gives
feedback.

The known defect makes it concrete: sketch 051 already identified that the existing
one-tour-per-session cap suppresses per-page first-run guidance, and named the fix
(*"B — first-visit overrides session cap"*). If that stays a sketch, every new hire meets
a tour that fires once, is skipped during service, and never returns. Training reverts to
oral transmission by a manager who resents the tool — and
[[AGENT_NATIVE_UI_DECISION]]:89-91 is explicit that oral training is the mechanism by
which the product spreads inside an account. Break it and the product stops spreading,
which does not show up as churn. It shows up as an account that never expands and renews
once.

**Earliest observable signal.** `design.time_to_first_real_action_staff_min` unmeasured at
the end of the first quarter — because if it is not being measured, it is being designed
for the owner. Second signal: any activation change shipped whose acceptance criteria
mention "owner" and not "staff".

**Counter-pressure.** The primary metric is **split by role from day one** (owner /
manager / staff) and staff is named as the number that matters, in the charter, before any
work starts. Role-based defaults — [[AGENT_NATIVE_UI_DECISION]]:102's *"cut the surface
with role-based defaults in a week, deterministically, with no telemetry"* — are the
team's first deliverable, not its third. And sketch 051's winner is executed rather than
re-explored; the question is already resolved.

---

## Cross-cutting counter-pressure

- **The two opposed teams must not be measured alike.** [[exploration-studio-charter]]
  succeeds by resolving questions and discarding most output;
  [[ux-path-burn-down-charter]] succeeds by shipping rows. Measure the studio on shipped
  pixels and it stops exploring; measure the burn-down on options generated and it stops
  shipping. [[design-directive]] keeps the two metrics structurally separate and forbids
  a combined "design velocity" number. If one ever appears on the board, that is the
  failure, not a reporting improvement.
- **The Media & Brand boundary is load-bearing** ([[design-charter]] non-goals). The
  earliest signal that it has collapsed is a Design artifact whose deadline is a launch
  date. Escalate the first instance.
- **The optimizer stays dark.** `design.ux_optimizer_rows` has a correct value of **0**.
  A non-zero reading means [[AGENT_NATIVE_UI_DECISION]]:78's verdict was reversed without
  a supersede-ADR — a decision failure, not a design one, and it belongs to
  [[decision-office-charter]] the moment it appears.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] should attack
  M2's ordering rule and M3's WIP constraint hardest — both are the kind of discipline
  that sounds obvious in a charter and evaporates in week six.
- **This document is subject to its own rule.** Nothing revisited in 60 days is fiction
  ([[README]] §3.3, §6). M1 and M3 have live baselines; check them, do not re-read them.
