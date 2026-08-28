---
type: agent-stack
division: product
department: design
team: ux-path-burn-down
status: designed
updated: 2026-08-27
metrics: [design.paths_closed_per_month, design.deferred_unblocker_ratio, design.ledger_drift_days, design.paths_closed_on_service_routes, design.blocked_on_endpoint_count]
links: ["[[ux-path-burn-down-charter]]", "[[ux-path-burn-down-schedule]]", "[[ux-path-burn-down-loops]]", "[[ux-path-burn-down-premortem]]", "[[0034-agent-stack-artifact]]", "[[design-agent-stack]]", "[[skills-charter]]", "[[exploration-studio-agent-stack]]", "[[engineering-charter]]", "[[data-charter]]", "[[UX_PATHS_CATALOG]]"]
---

# UX Path Burn-Down — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team exists because a 910-row ledger with no owner **contradicted itself** and nobody
> noticed ([[ux-path-burn-down-charter]] §Evidence). Its agent is therefore a reconciler, not
> a designer: it resolves cells against the repository, and it is forbidden from deciding
> whether an artifact satisfies a row — that judgment goes to a human every time.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `ux-ledger-reconciler` | Check every "Unblocked by" cell in the Deferred Decisions Log against the repo, keep the log and the section banners in parity, and publish the close count with its service-route split and endpoint-blocked census | NEW |

One row. Burn-down *delivery* is human design work; what has no owner today is the
**accounting**, and that is what the card covers.

## 2. Agent cards

```yaml
agent: ux-ledger-reconciler
unit: ux-path-burn-down
triggers:
  - schedule: "weekly — blocker reconciliation, banner parity, close report, endpoint census"   # [[ux-path-burn-down-schedule]]
  - schedule: "quarterly — denominator audit (unique NEW- ID count)"
  - topic: catalogue.row_closed     # publisher: NONE (gap — closing a row is a hand edit inside a PR; nothing emits)
consumes:
  - ".planning/07-reference/UX_PATHS_CATALOG.md:10-67 (Deferred Decisions Log) and the 24 section banners — grep targets by line range, never the whole 157,641-byte file (CLAUDE.md §2)"
  - the repo tree, to resolve each "Unblocked by" cell against disk
  - "winners handed over by [[exploration-studio-agent-stack]] as manifest rows naming a receiving team"
emits:
  - "one verdict per deferred row — still-blocked / now-unblocked / **uncheckable** — as a PR against the log"
  - "design.ledger_drift_days, design.paths_closed_per_month, design.paths_closed_on_service_routes, design.blocked_on_endpoint_count → [[design-agent-stack]] board rollup"
  - "orphan-route findings → [[surface-portfolio-charter]] as findings, never as decisions"
  - nf_a events (task_type: ledger_reconcile)
routing_class: mechanical     # grep, resolve, diff — "is this artifact on disk" has one right answer
quality_bar: "reproducible — a rerun on the same commit yields the same per-class counts; every cell resolves or is reported *uncheckable*, zero silent skips ([[ux-path-burn-down-schedule]]). NONE (gap) — ADR 0017 has no verdict grader for a ledger audit"
autonomy:
  read: autonomous
  propose: autonomous         # every log edit is a PR a human merges
  mutate_stock_money_outbound: confirm    # constant
memory: ux-path-burn-down
escalates_to: "[[design-charter]]"
```

**The card's own hard rules.** The reconciler never marks a row *Shipped*: existence on disk
is mechanical, but *"does this artifact satisfy the acceptance criteria"* is judgment and is
escalated, not decided — the class boundary is deliberate. And it may not answer **PROD-F5**
by commissioning anything; it counts blocked rows so the open fork stays visible
([[FORK-REGISTRY]]).

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `ux-ledger-reconcile` | T2 | Weekly, and before any section is prioritized | Every `:10-67` cell resolves to a repo artifact or is reported uncheckable; zero silent skips | **`UX_PATHS_CATALOG.md:49` vs `:1013`** — §AA marked blocked on a Seating Density widget that shipped as `apps/web/src/components/reports/organisms/SeatingDensityPanel.tsx` on 2026-07-27 | NEW |
| `ux-banner-parity` | T2 | Weekly, alongside reconcile | Log rows and the 24 section banners agree, or the diff is published | The `:15` instruction (*"Update both places when a deferred item ships"*) failed on that same §AA row — an instruction, not a check | NEW |
| `ux-path-count` | T2 | Quarterly, and on any catalogue edit | Unique `NEW-` ID count published and propagated to every doc quoting it | **760 vs 910** — [[engineering-premortem]] M5 and the founder's working notes both quote the stale denominator the 2026-08-24 count corrected | NEW |
| `ux-path-to-e2e` | T2 | On closing a row | A test exists whose name reads as the row's trigger→outcome sentence (`:70`) | The P0 Recommendations closure (`NEW-284…308`) and the other ~90–100 closed paths left **no test-level record of what "closed" meant** | NEW |

`ux-service-route-split` is on [[ux-path-burn-down-schedule]] but its instance column reads
*"never done"* — under README §3.3 rule 3 that is not a skill row, so it is absent here. The
weekly close report produces the split by hand until the first run becomes its instance.

Consumed, owned elsewhere: the skill envelope and registry ([[skills-charter]]).

## 4. Memory

- **Procedural** — the four §3 skills; candidates via [[skill-harvesting-charter]]'s queue,
  still through the §3.3 gate.
- **Episodic** — nf_a `task_type: ledger_reconcile`. Needs `context.section` (the 29 lettered
  sections) and `context.row_class` (still-blocked / now-unblocked / uncheckable) as jsonb
  keys, so "which section rots fastest" is one filter rather than a re-read of the log.
- **Semantic** — `memory/` beside this file, `ux-path-burn-down-MEMORY.md` as index, one fact
  per file with `source` / `confidence` / `last_verified`. Its first two files are already
  written in the charter: the Seating Density drift, and *"the denominator is 910, quoted as
  760 elsewhere."* Every write is a PR — a ledger whose corrections are diffable is the point.
- **Working** — this card, the MEMORY index, charter §Mandate, and `:10-67`. The rest of the
  catalogue is retrieved by line range on demand; loading 1,867 lines to check one cell is
  the CLAUDE.md §2 failure in miniature.

**Consolidation** — monthly, alongside the escalation and inflow reviews in
[[ux-path-burn-down-schedule]]: read the month's reconcile events; every drift event becomes
a fact naming the **mechanism** (*"two places must be updated by hand"*), never the symptom
(*"row 49 was stale"*); a row that flipped to uncheckable twice becomes a fact about the
cell, not the week; expire facts unverified 90 days; propose skill candidates. One PR;
"no delta" stated out loud when true.

## 5. Async contract

Interaction is loops ([[ux-path-burn-down-loops]]), NF-A events, and vault PRs. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `catalogue.row_closed` has no publisher | A row closes by hand inside a product PR; nothing emits, so the weekly schedule bounds the detection lag at 7 days — which is already better than the 2026-07-27→2026-08-24 lag the charter documents |
| `design.blocked_on_endpoint_count` has no committed consumer | **PROD-F5** is open: [[engineering-charter]] owns the build, but nobody has accepted commissioning. Published monthly so the cost of the open fork is visible ([[ux-path-burn-down-charter]]) |
| The ~70 §AA rows blocked on data with no table | The unblocker is a schema, not a design artifact ([[data-charter]], `UX_PATHS_CATALOG.md:64`). No Data agent publishes table-existence today, so those cells resolve as **uncheckable** rather than silently as blocked |
| Winners arrive as vault artifacts, not events | [[exploration-studio-agent-stack]] names the publisher, but arrival is a manifest PR nobody is notified of; `design.handoff_age_days` measures the latency instead of hiding it |

## 6. Evidence today

- **EXISTS — everything the reconciler would read.** 910 unique `NEW-` IDs across 29
  sections, the consolidated Deferred Decisions Log at `:10-67` (every row already carrying
  *why deferred* and *unblocked by*), 24 "Shipped" banners `:337`…`:1601`, and the
  `SeatingDensityPanel.tsx` file whose existence is the contradiction (verified on disk this
  session).
- **NEW — the agent and all four skills.** The reconciliation has been done exactly once, by
  hand, in the 2026-08-24 charter pass; that run is the past instance every row cites.
- **PARTIAL — the metrics.** `design.deferred_unblocker_ratio` is unusually high and
  measurable today; `design.ledger_drift_days` is **non-zero and unknown**; the service-route
  split and the endpoint census have **never been measured**.
