# 058 — research-math-agenda-canvas

**Design question.** Can a department whose four headline metrics are all blank show
a *real* agenda on one page — without the blanks reading as failure, or the reader
mistaking a schedule for a result?

**Date:** 2026-08-28 · **Unit:** [[research-math-charter]] · **Under:**
[[0039-activation-plan-of-record]] Track B · **Files:** `canvas.html` (self-contained,
no network requests, no build step — open it directly)

## What it shows

One page, four bands:

1. **The metric set**, with `not measured` rendered as an *italic grey value* rather
   than an empty cell. This is the whole visual thesis: on this department's board a
   blank is a status, and a canvas that leaves it empty tempts the next reader to fill
   it with an estimate ([[research-math-premortem]] M2).
2. **A five-lane × six-date timeline** — RM-1 Harness & Model Routing, RM-2 Evaluation
   & Doneability, RM-3 NF Instrumentation, RM-4 Backtests, and the department itself —
   with every task chip carrying its ID, its close-time (its column) and its
   doneability (the `done when` line). A hatched chip waits on a unit we do not
   control; `↻` means recurring and the column is the first run.
3. **The seams**, as clickable chips. Clicking one dims every task that does not cross
   it — the fastest way to see that this department's agenda is mostly *contracts with
   other units*, which is the honest shape of a methodology-owning department under
   [[0036-cost-routing-two-plans-in-harmony]].
4. **Held / deleted / unowned** — the locks observed, the two candidate tasks deleted
   for having no doneability, and the three findings no card or loop can carry.

## Why this form and not the others

- **Not a Kanban.** Columns of *status* would show motion; there is none yet, and a
  board full of "todo" would be a truthful picture drawn in the most discouraging
  possible way. Columns of *close-time* show commitment instead, which is the thing
  this agenda is actually making.
- **Not a dependency graph.** The interesting edges here are not task→task, they are
  task→**unit we do not control**. A graph would bury that in nine crossing lines; the
  seam filter surfaces it in one click.
- **Not a burndown.** The department is chartered on ratios and costs, never on
  velocity ([[research-math-charter]] §Metrics). A burndown would smuggle a velocity
  metric onto a board where the schedule explicitly forbids one.

## Verified

Rendered at 1500×1000 and at 560×840 (it reflows; the timeline scrolls horizontally
inside its own container rather than the page scrolling). Every number on the canvas
is either a `path:line` citation or a command whose output is quoted in
[[research-math-agenda-full]] §0 — `python3 scripts/check_task_types_are_graded.py`,
run 2026-08-28, `39 emit · 27 verdict · 12 exempt · 0 ungraded`.

## Throwaway-grade

Per the sketch conventions this is a thinking surface, not a product. The tasks are
authoritative in [[research-math-agenda-full]]; if the two ever disagree, the agenda
is right and this file is stale.

**Manifest row:**

`| 058 | research-math-agenda-canvas | Can a department whose four headline metrics are all blank show a real agenda on one page — without the blanks reading as failure? | — | agenda, research-math, wave-3, metrics, blank-is-a-status, seams, timeline, doneability, close-time |`
