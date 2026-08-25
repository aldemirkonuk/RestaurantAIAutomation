---
type: charter
division: product
department: design
team: ux-path-burn-down
status: exists
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.ledger_drift_days, design.paths_closed_on_service_routes, design.blocked_on_endpoint_count]
updated: 2026-08-24
links: ["[[design-charter]]", "[[ux-path-burn-down-premortem]]", "[[ux-path-burn-down-agenda-full]]", "[[ux-path-burn-down-agenda-board]]", "[[ux-path-burn-down-directive]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-schedule]]", "[[exploration-studio-charter]]", "[[design-system-motion-substrate-charter]]", "[[UX_PATHS_CATALOG]]", "[[engineering-charter]]", "[[data-charter]]", "[[surface-portfolio-charter]]", "[[analytics-bi-charter]]", "[[decision-office-charter]]"]
---

# UX Path Burn-Down — Charter

Parent: **[[design-charter]]** (Product division). Siblings:
[[design-system-motion-substrate-charter]], [[exploration-studio-charter]],
[[activation-in-product-guidance-charter]].

## Mandate

Own `.planning/UX_PATHS_CATALOG.md` as a **live execution ledger**: which of its 910 paths
ship, in what order, with what acceptance criteria, and — for every deferred path — the
named thing that unblocks it, verified against the repository rather than remembered.

## Boundaries

Owns outright:

- **The ledger.** `.planning/UX_PATHS_CATALOG.md` — 1,867 lines, 157,641 bytes,
  **910 unique `NEW-` IDs** (`NEW-001…NEW-910`) across **29 lettered sections**, counted
  this session.
- **The Deferred Decisions Log** at `:10-67` — every row's *why deferred* and *unblocked
  by*, and the reconciliation of both against the repo.
- **Path definition, priority, and acceptance criteria.** The catalogue's reading rule at
  `:70` is *"Given I am on page X, When I `<trigger>`, Then `<outcome>`"* — so a path is
  simultaneously a spec and an E2E test scenario, and this team owns both readings.
- **The count.** Including correcting it where it is wrong elsewhere (see Evidence).

## Why distinct from its siblings

This is **convergent delivery accounting, not design**. Its unit of work is a row that
either exists in the product or does not.

[[exploration-studio-charter]] does the opposite job: divergent exploration where most
output is correctly discarded. One team cannot hold both success criteria — measure this
team on options generated and it stops shipping; measure the studio on shipped rows and it
stops exploring. [[design-directive]] forbids combining the two numbers for exactly this
reason.

Distinct from [[surface-portfolio-charter]] (Product & Vision) on a line that is written
down rather than invented here: they decide **whether a page should exist**; this team
owns **what is on it and how it behaves** (`product.md:182-185`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Building the endpoints deferred rows are blocked on | [[engineering-charter]] | We own definition, priority, acceptance criteria. **Whether we may *commission* is an open fork — see below** |
| The ~70 §AA rows blocked on data with no table — reservations, weather, labor, turn-time, per-seat pours, per-hour series, forecasts, host tablets (`:64`) | [[data-charter]] | A Data dependency, not a design one. We keep the rows written and the unblocker named; we do not model the schema |
| Deciding a page should be killed or merged | [[surface-portfolio-charter]] | Route inventory is theirs. If we find an orphan while burning down, it is a **finding**, not a decision |
| What an insight *is* | [[analytics-bi-charter]] | We own how it is read and acted on |
| Posing an unresolved design question | [[exploration-studio-charter]] | If a row needs a decision that does not exist, it goes back to the studio rather than getting designed in production |
| Creating new primitives to close a row | [[design-system-motion-substrate-charter]] | Burn-down composes; it does not invent substrate. Every exception is how M4 happens |

## Metrics it moves

**Primary: `design.paths_closed_per_month`** — paired, always, with a **honesty ratio**
`design.deferred_unblocker_ratio` = deferred rows carrying a named unblocker ÷ all
deferred rows. That ratio is unusually high today, and **protecting it is the point** —
it is the property that makes this catalogue different from every other backlog in the
repo.

Three secondaries, each guarding a specific failure:

| Metric | Guards against | Reading today |
|---|---|---|
| `design.ledger_drift_days` | The log disagreeing with the product | **Non-zero, unknown** — at least one row stale |
| `design.paths_closed_on_service_routes` | Burning down the enumerable rather than the important | Never measured |
| `design.blocked_on_endpoint_count` | The commissioning fork being avoided rather than answered | Never counted |

**Neural-footprint tie.** None directly — this team ships operator-facing surface. The
indirect tie is real: rows on guest-facing surface define what a `nf_b.stimulus` event can
record, and rows on the recommendation/approve pattern define where `nf_a.outcome` gets a
human verdict. Neither emits today ([[README]] §1, L4).

## Evidence today

**EXISTS — and unusually well-instrumented for a backlog.**

- **910 unique `NEW-` IDs**, `NEW-001…NEW-910`, verified by count this session against
  `.planning/UX_PATHS_CATALOG.md`. **29 lettered sections.**
- **A consolidated Deferred Decisions Log at `:10-67`** where every deferred item already
  carries *why deferred* **and** *unblocked by*. This is the rarest artifact in the repo: a
  backlog that knows its own dependencies.
- **24 "Shipped" mentions** across the file (`:337`…`:1601`) — the burn-down is real and
  partly done. Roughly 90–100 paths closed: P0 Recommendations `NEW-284…308`, Browse-All
  §Z1, contextual rails, §A command palette, §K calendar.
- **The reading rule at `:70`** makes every row an E2E scenario, which is why this team
  doubles as the test spine.

### 🔎 The live contradiction — the best argument for this team's existence

The Deferred Decisions Log at `:49` still says §AA rows (`NEW-761…860`) are blocked
because *"the Reports 'Seating Density' widget these rows reference **does not exist
yet**"*.

**It does exist.** `:1013` announces *"Seating Density widget (`SeatingDensityPanel`) —
unblocks NEW-761–860"*, and the file is on disk:
`apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx`, 31,233 bytes, last
modified 2026-07-27.

The log's own instruction at `:15` is **"Update both places when a deferred item ships."**
It was not followed. A 910-row ledger with no owner drifts against itself, and the drift
is invisible until someone greps. **This single row is the charter.**

- **The residual §AA blocker is real and differently shaped.** ~70 of the rows are
  *"authored against data with no table: reservations, weather, labor, turn-time, per-seat
  pours, per-hour series, forecasts, host tablets"* (`:64`). That is a Data dependency and
  it belongs to [[data-charter]] — which means the §AA block is **partly false and partly
  true**, and nobody has separated the two halves.

### A correction this team owns

The catalogue is described elsewhere as *"a 154KB, 760-path corpus"* —
[[engineering-premortem]] M5, and the founder's working notes. The byte count is right
(157,641 ≈ 154 KiB). **The path count is 910.** The corpus grew and the secondhand number
did not. Fixing the figure wherever it appears is this team's first housekeeping act,
because a burn-down against a wrong denominator reports a wrong percentage forever.

## Tension named, not hidden

**Most deferred rows are blocked on endpoints, not on design.** So the split must be
explicit: this team owns the path's definition, priority, and acceptance criteria;
[[engineering-charter]] owns the build.

**A burn-down team that cannot commission endpoints will report "blocked" for a year.**
That is the open fork **PROD-F5** (`product.md:862`, originally proposed as "OD-24" — see
the resolved ID collision in [[design-charter]] and [[FORK-REGISTRY]]). Until it closes, `design.blocked_on_endpoint_count` is published
monthly so the cost of leaving it open is visible rather than absorbed.

## The state the ledger does not have

There is no **"will not build"** status. Every one of the 910 rows is implicitly a
commitment. If the catalogue is in fact an inventory from which a subset ships, the ledger
needs that state, and adding it is a founder call, not a team one
([[ux-path-burn-down-agenda-full]], question 2).
