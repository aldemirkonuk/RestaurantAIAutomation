---
type: premortem
division: product
department: design
team: ux-path-burn-down
status: provisional
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.ledger_drift_days, design.paths_closed_on_service_routes]
updated: 2026-08-24
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-directive]]", "[[design-premortem]]", "[[exploration-studio-charter]]", "[[engineering-charter]]", "[[data-charter]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[UX_PATHS_CATALOG]]", "[[AGENT_NATIVE_UI_DECISION]]"]
---

# UX Path Burn-Down — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. This team has failed. What happened?

The department's premortem line for this team is a single sentence: *it burns down the 100
seating-density rows because they are enumerated and feel tractable, ships more Reports
surface nobody opens, and the paths that would have made `/inventory` usable stay deferred
for another year — while the ledger itself drifts out of date, exactly as `:49` already
has.* Expanded into five mechanisms:

---

### M1 — The ledger drifted, and the team acted on false blockers

Already in progress. `UX_PATHS_CATALOG.md:49` claims the Seating Density widget does not
exist; it has been on disk since 2026-07-27. That is one stale row that took one grep to
find, in a log with dozens of rows and an explicit maintenance instruction at `:15` that
was not followed.

The failure completes when the team **trusts the log**. Planning reads "blocked", routes
around the section, and the routing is wrong. Worse: the log's greatest strength — that
every deferred row names its unblocker — becomes its greatest liability, because a
confidently wrong dependency graph gets acted on, whereas an absent one gets checked.

**Earliest observable signal.** One deferred row whose stated blocker has resolved without
the row's status changing within one close-time. The signal is available **today**,
unexamined: nobody has ever counted the stale rows.

**Counter-pressure.** Reconciliation is a **weekly script, not a habit** — loop
`L-UXB-1`. The instruction at `:15` failed precisely because it depended on a human
remembering during a burn-down session, and the counter-pressure to a failed human
instruction is never a firmer human instruction. `design.ledger_drift_days` sits on
[[ux-path-burn-down-agenda-board]]. The Seating Density row is repaired as the team's
first act — not because that row matters much, but because closing known drift before
opening new work is the entire discipline.

---

### M2 — 100 adjacent rows ate the year

`NEW-761…860` are enumerated, sequential, individually small, and thematically coherent.
They produce a burn-down chart that looks excellent. Roughly 70 of them are blocked on
tables that do not exist (`:64`) — but the other ~30 are shippable, and shipping them
feels like momentum.

Twelve months later: more Reports surface nobody opens, a healthy
`design.paths_closed_per_month`, and the paths that would have made `/inventory` usable at
4pm on a Friday still deferred. The catalogue rewarded volume; the product needed
judgement. And because the section is *nearly* complete, finishing it becomes its own
argument.

**Earliest observable signal.** Three consecutive close-times where
`design.paths_closed_per_month` moves and `design.paths_closed_on_service_routes` does
not. Both numbers exist for exactly this comparison; the second will never fall out of the
first.

**Counter-pressure.** The ordering rule in [[ux-path-burn-down-directive]] is **frequency
of use during service**, derived from [[PAGE_MAP]] in-degree plus the turnover constraint
at [[AGENT_NATIVE_UI_DECISION]]:87-95 — not catalogue order, and explicitly not section
completeness. **A section may never be completed as a unit.** That rule exists to make 100
adjacent rows *less* attractive than 6 scattered ones, which is counterintuitive and
therefore has to be written down.

---

### M3 — "Blocked" became the team's product

Most deferred rows are blocked on endpoints, not on design. The commissioning fork
(`product.md:862`) stays open because nothing forces it closed. Each sprint the team
writes excellent acceptance criteria, files them, marks them blocked, and moves on. The
honesty ratio stays beautiful. Twelve months of output is a very well-maintained list of
things that did not happen.

This is the failure mode the charter names out loud: *a burn-down team that cannot
commission endpoints will report "blocked" for a year.* It is not hypothetical — it is the
default outcome of leaving a fork open, because an open fork always favours the status quo.

**Earliest observable signal.** `design.blocked_on_endpoint_count` rising for two
consecutive close-times **with no escalation filed**. The rise is not the signal; the
*silence* is. A team genuinely trying to unblock escalates.

**Counter-pressure.** [[ux-path-burn-down-directive]] escalates the **first** blocked-on-
endpoint row, not the tenth, and the count is published monthly to
[[decision-office-charter]] so the cost of the open fork is visible rather than absorbed.
Interim rule while the fork is open: the team may not carry more than one close-time's
worth of endpoint-blocked rows without a named Engineering counterpart per row. A blocker
with no name on it is not a blocker, it is a wish.

---

### M4 — The honesty ratio was gamed without anyone deciding to game it

`design.deferred_unblocker_ratio` rewards deferred rows that carry a named unblocker.
Under pressure, "unblocked by: further design work" and "unblocked by: prioritization"
appear. Both are technically named. Both are content-free. The ratio stays at 100% and
means nothing, and the one metric that made this backlog special quietly dies of
politeness.

**Earliest observable signal.** The first "Unblocked by" cell whose text does not name a
**checkable artifact** — a file, a table, an endpoint, a decision ID. Concretely: a cell
that the weekly reconciliation script cannot mechanically verify. The script's inability
to check a cell *is* the alarm, and it should be reported as such rather than skipped.

**Counter-pressure.** An unblocker must be **machine-checkable**: a path, a table name, an
endpoint, or an `OPEN-DECISIONS.md` ID. `L-UXB-1` reports three numbers, not one —
verified-and-still-blocked, verified-and-now-unblocked, and **uncheckable**. The third
number is the one that predicts this failure, and it is the one a summary would drop.

---

### M5 — The catalogue became the definition of the product

910 rows is a large enough corpus to feel exhaustive. Within a year, "is it in the
catalogue?" replaces "should it exist?" Rows nobody would write today get built because
they are enumerated; problems nobody enumerated go unaddressed because there is no row for
them. The ledger stops describing the product and starts governing it — and it has no
"will not build" state, so every one of the 910 rows is an implicit commitment nobody ever
made explicitly.

**Earliest observable signal.** A close-time in which every shipped item came from the
catalogue and no new row was written from a real user observation. Perfect ledger
adherence is the tell.

**Counter-pressure.** Two structural, one procedural. Structural: the ledger gets a
**"will not build"** status (founder call — [[ux-path-burn-down-agenda-full]] question 2),
so pruning is a recorded act rather than a silent omission; and
[[surface-portfolio-charter]] retains the *whether-a-page-exists* call, so the catalogue
cannot annex it. Procedural: each close-time, at least one row must **originate outside
the catalogue** — from a support question, an observed service moment, or an
[[exploration-studio-charter]] winner. A backlog with no inflow from reality is a museum
catalogue.

---

## Cross-cutting counter-pressure

- **The two numbers are always published together.** Total closed and service-route
  closed. If a board ever shows only the first, M2 has already happened.
- **This team's failures are legible and its successes are boring.** Repairing `:49`
  produces no visible product change. [[red-team-charter]] should attack the ordering rule
  (M2) and the machine-checkable-unblocker rule (M4) hardest, because both are disciplines
  that sound obvious in a charter and evaporate under a deadline.
- **The denominator must be right.** The corpus is **910**, not the 760 quoted in
  [[engineering-premortem]] M5. A burn-down percentage against a wrong denominator is
  wrong for as long as nobody re-counts.
