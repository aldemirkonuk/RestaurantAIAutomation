---
type: agenda-full
division: platform
department: data
status: provisional
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate]
updated: 2026-08-24
links: ["[[data-charter]]", "[[data-premortem]]", "[[data-agenda-board]]", "[[data-loops]]", "[[data-directive]]", "[[data-schedule]]", "[[corpora-enrichment-agenda-full]]", "[[annotation-ground-truth-agenda-full]]", "[[synthetic-generation-simulation-agenda-full]]", "[[pos-operational-telemetry-ingest-agenda-full]]", "[[substrate-quality-coverage-agenda-full]]", "[[README]]"]
---

# Data — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. Nothing below has been
> decided; the department exists as a charter, not as running org.

## What

Unblock **L0** without lying about how unblocked it is.

Concretely, the department is accountable for four producing streams and one auditor, and
its near-term agenda is dominated by a single structural problem: **the machinery is
ahead of the substrate**. Enrichment services, synthetic generators, annotation tooling
and POS ingest all exist and run. What does not exist is enough correct data on the other
end of them, and — more dangerously — a reporting format that makes the gap legible.

Three things must be true before this department can claim anything:

1. Every coverage number names its **denominator**.
2. Every substrate row names its **provenance**.
3. Every producing team's primary metric measures **fitness, not volume**.

None of the three is true today.

## How

**Split by truth guarantee, not by data type.** The five teams are not wine/food/sales/POS —
that grouping would put four incompatible epistemics inside one team and none inside
another. They are *probabilistic · verified · constructed · observed · audited*
(`technology.md:555-560`). This is the department's central design claim and everything
else follows from it.

**Author ≠ auditor.** [[substrate-quality-coverage-charter]] measures and does not produce.
The cost is a team that ships nothing; the benefit is a grade that means something. The
charter records the reservation honestly ([[data-charter]] §"On five teams") and names the
condition under which the split should be reversed.

**Demand, not alphabetical.** The enrichment queue is ordered by
`enrichment_demand_priority` — wines that have sold recently, then wines that have sold,
then the rest (`supabase/migrations/20260813170000_enrichment_demand_priority.sql:103`).
Two years of full-library enrichment is not a plan; one year of the top 15% is.

**Publish the knob next to the dial.** Quality thresholds and the quarantine rate they
produce are always reported together. This is the direct counter to [[data-premortem]] M4
and it costs nothing but discipline.

## Why now

- **[[README]] §1 names L0 as the blocker.** Not as a risk, as *the* blocker. Every other
  department's ceiling is set here.
- **The wine enrichment run is live and in-session** (`8bbcde6`, `ef19b81`), which means the
  denominator decision (M1) is being made *right now*, implicitly, by whatever query picks
  the next batch. Deciding it explicitly is cheap today and expensive in six months.
- **Dish identity was deferred with its design written** (`b728d25`). That is the right way
  to defer, and it has a shelf life. A deferral without a date becomes a cancellation
  nobody voted for.
- **The analytics engine already consumes this substrate** — `apps/api-gateway/src/analytics/`
  (39 routes) — so sparse sales data is not a future problem, it is currently producing
  baselines.

## Next steps

Ordered. Nothing here is scheduled; these are the first moves the department would make.

| # | Move | Owner | Why first |
|---|---|---|---|
| 1 | Fix the reporting format: three L0 numbers (wine · dish · sales), each with a named denominator | Department | Kills M1 and M3 before either can start |
| 2 | Add `source_guarantee` to the substrate intake contract; count rows without it | [[substrate-quality-coverage-charter]] | M2 is the only unsurvivable mechanism |
| 3 | Re-point the enrichment queue at `enrichment_demand_priority` and publish both coverage figures | [[corpora-enrichment-charter]] | The run is live; the denominator is being chosen implicitly today |
| 4 | Give the POS unresolved queue a named owner and a close-time | [[pos-operational-telemetry-ingest-charter]] | Unowned queues are M5's mechanism |
| 5 | Date-stamp the dish-identity deferral or escalate it as a drop decision | Department → `OPEN-DECISIONS.md` | An undated deferral is fiction |
| 6 | Establish the threshold-change protocol (decision, not config edit) | [[substrate-quality-coverage-charter]] | Must exist *before* the first milestone squeeze, not after |
| 7 | Backtest the synthetic set against the real gold set once, to get a baseline fidelity gap | [[synthetic-generation-simulation-charter]] | Fidelity with no baseline is unfalsifiable |

## Questions for the founder

1. **The dish corpus.** Is food genuinely in scope for this cycle, or is the honest answer
   that Mudavym is a wine company first and dish identity is a v2 concern? Both are fine.
   *Carrying it as scope while never funding it is not.* ([[data-premortem]] M3)
2. **The demand denominator.** Demand-weighted coverage will look **worse** than
   library coverage for a long time, possibly a year. Is that a number you are willing to
   put in front of an investor, given it is the true one?
3. **Sales density.** The analytics engine is live on thin sales data today. Do we (a) keep
   shipping insights and label their confidence, (b) gate insights below a density
   threshold, or (c) accept the risk silently? Option (c) is currently in force by default.
4. **The auditor's independence.** [[substrate-quality-coverage-charter]] can only work if
   its quarantine gate can actually block a publish. Does it have that authority, or is it
   advisory? If advisory, the charter says it should be merged.
5. **Annotation is your time.** The gold set is the one asset no agent can produce
   ([[annotation-ground-truth-premortem]] M1). How many hours per month is real?
6. **OD-23** — 7 artifacts per team, or 3? This department alone is 35 documents under the
   current answer.
