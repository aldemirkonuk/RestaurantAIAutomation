---
type: premortem
division: platform
department: data
status: provisional
metrics: [corpora.demand_weighted_coverage, substrate.quarantine_rate, pos.line_resolution_rate, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap]
updated: 2026-08-24
links: ["[[data-charter]]", "[[data-loops]]", "[[data-directive]]", "[[data-agenda-full]]", "[[corpora-enrichment-premortem]]", "[[annotation-ground-truth-premortem]]", "[[synthetic-generation-simulation-premortem]]", "[[pos-operational-telemetry-ingest-premortem]]", "[[substrate-quality-coverage-premortem]]", "[[red-team-charter]]", "[[decision-office-charter]]", "[[README]]"]
---

# Data — Premortem

> Written at founding, before success is assumed.

This premortem carries more weight than most in the org, for one reason: **L0 is the named
blocker** ([[README]] §1). If Engineering fails, a feature is late. If Data fails, every
layer above it is confidently wrong, and the failure is invisible from inside the product
because the rows *look* fine. Five mechanisms follow, most likely first.

---

## M1 — The denominator moved, and L0 was declared solved on the wrong base

The library holds 1,448 wines and 144 are enriched. Full-library coverage is the number
that moves fastest — every enrichment run adds to it, no prioritization required. The
demand-weighted number, the share of wines **actually on customer menus**, moves far more
slowly and is far harder to explain. Within two quarters the reported figure is
library-coverage, it crosses 60%, "the wine corpus" is declared done, and the sommelier
feature ships against menus whose bottles are still empty rows.

The repo already knows this is the trap. `supabase/migrations/20260813170000_enrichment_demand_priority.sql:28-31`
lays out the arithmetic explicitly — top 30% by demand is 90,000 records and two years;
top 15% is 45,000 and one year — and the function was rewritten so that "eligibility is
now ordered by demand first" (`:31`). The mechanism is not that we lack the tool. It is
that the easy number and the true number both exist, and only one of them is pleasant.

**Earliest observable signal.** The **first** progress report that states a single coverage
percentage without naming its denominator. Not the tenth. Concretely: a line in the daily
substrate report ([[README]] §6) reading "wine coverage: N%" with no
`demand_score`-weighted twin beside it.

**Counter-pressure.** [[corpora-enrichment-charter]]'s primary metric *is* the
demand-weighted one, and [[data-loops]] `demand-reprioritization` closes weekly off the
`enrichment_demand_priority` function rather than off a hand-picked queue. Both numbers
appear on [[data-agenda-board]] side by side, permanently — the library number is not
banned, it is **never allowed to appear alone**. If the two diverge for three consecutive
close-times, the enrichment queue is re-sorted, not the report.

---

## M2 — The four truth guarantees blended, and every accuracy number became meaningless

This department deliberately holds four incompatible kinds of truth in one place:
probabilistic (enriched), human-verified (annotated), true-by-construction (synthetic),
and observed (POS). The blend happens quietly and in the cheapest possible way. A gold set
is short 300 rows before a benchmark run, and enrichment output — which is *usually right*
— is used to top it up. Synthetic documents are counted toward "documents processed"
in a coverage figure. A POS-derived velocity is compared against a synthetic baseline
without either being labelled. Nothing breaks. Every accuracy claim for the next year is
a model being graded against its own output, and the number is *high*, which is precisely
why nobody questions it.

`services/agent-orchestrator/services/active_learning_service.py:14-17` describes a loop
that runs *correction → rule learner → benchmark validation → merge*. That loop is
excellent, and it is exactly the loop that silently self-confirms if the benchmark set and
the correction stream ever share a source.

**Earliest observable signal.** The first row admitted into `datasets/annotated/` or a
benchmark set whose provenance is unstated. Also: any coverage or accuracy figure reported
without a source breakdown — the reporting format is the tell, well before the data is.

**Counter-pressure.** Provenance is a **required field at intake, not an annotation added
later**: every substrate row carries `source_guarantee ∈ {scraped, annotated, synthetic,
observed}`, and every eval query filters on it explicitly rather than by convention. The
department's non-negotiable: *a set may not be graded by anything that shares its
provenance*. [[substrate-quality-coverage-charter]] runs `provenance-integrity-audit`
weekly ([[data-loops]]) and reports rows-without-guarantee as a hard count, not a rate —
rates hide small absolute numbers, and 300 contaminated gold rows is a catastrophe at any
rate.

---

## M3 — Wine got the whole department; food and sales stayed thin

The blocker is named as **"wine/food corpora, sales metrics, POS traffic"** ([[README]] §1).
Wine has ten services, four scripts, a seed library, five dataset directories, a
demand-priority migration, and a producer-reputation plan that reached 100% coverage on
the menu corpus (`f7e0ea1`). Food has `datasets/menu_corpus/`, a scale plan, and a design
that was **explicitly deferred** (`b728d25 docs(a15): defer dish identity, but write the
design before deferring`). Sales is graded PARTIAL by the department's own evidence pass.

Wine is where the momentum, the tooling, and the founder's expertise are — so wine is
where the next unit of effort goes, every time, defensibly, for twelve months. The wine
corpus becomes genuinely excellent. The product still cannot answer a question about a
dish, and `apps/api-gateway/src/analytics/` (39 routes) is still fitting baselines on a
sales corpus too sparse to fit anything.

The deferral was written down honestly, which is the good news. Deferrals that were written
down honestly are still deferrals twelve months later.

**Earliest observable signal.** Three consecutive close-times in which the wine number
moves and the dish and sales numbers do not move **at all** — not "move slowly". Zero
movement three times is a reallocation trigger, not a status update.

**Counter-pressure.** The daily substrate report emits **three numbers, never one**
([[data-loops]] `l0-blocker-tri-report`): wine coverage, dish coverage, sales density. The
department is structurally forbidden from reporting "L0 progress" as a scalar. Dish
identity has a written design and a stated entry trigger already (`b728d25`); the trigger
gets a date on [[data-agenda-board]], and a deferral that survives three reviews without a
date escalates to `OPEN-DECISIONS.md` as a decision to *drop* the food corpus, not to keep
deferring it. Killing it honestly beats carrying it as fiction.

---

## M4 — The auditor was re-absorbed, and the dashboard stayed green while the substrate rotted

[[substrate-quality-coverage-charter]] exists because a producer cannot grade itself
(`technology.md:32-34`). But it grades using thresholds, and thresholds are configuration.
A coverage milestone is two weeks out; a confidence cut-off is demonstrably slightly too
strict on a class of rows that are *obviously* fine; the threshold is relaxed — correctly,
once, with a reason. `supabase/migrations/20260814000000_data_quality_rescale.sql` shows
rescaling is already a thing this system does. The second relaxation cites the first as
precedent. Quarantine rate falls, coverage rises, both charts are green, and the substrate
underneath is worse than it was in month three.

The specific danger is not dishonesty. It is that **the metric and the knob end up in the
same hand** — which is what happens the moment the auditor is measured on whether the
producers hit their milestones.

**Earliest observable signal.** Any change to a confidence threshold, a governance tier
boundary (`services/agent-orchestrator/services/governance.py:107`), or a quarantine rule
that lands **in the same close-time as a coverage milestone**. The co-occurrence is the
signal; the change itself may be entirely correct.

**Counter-pressure.** Threshold values are **decisions, not config**: a change goes to
`OPEN-DECISIONS.md` with a named owner and a close-time, and is never a silent edit
([[decision-office-charter]] owns that a decision closes). `substrate.quarantine_rate` is
reported **beside the threshold value that produced it** on every board, so a fall caused
by a knob and a fall caused by better data are visually distinguishable. And the auditor is
never measured on producer milestones — [[data-directive]] states that explicitly.
Backstop: [[red-team-charter]] attacks this decision specifically, since threshold drift is
a decision failure and that is its scope ([[ORG_STRUCTURE]] §3).

---

## M5 — Volume was mistaken for fitness, and six months of POS turned out unjoinable

Ingest is easy to measure by rows landed and hard to measure by rows usable. The webhook
returns 200, the row is written, the counter goes up — and
`supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql` exists
precisely because some of those lines never resolve to a catalogue item. The review queue
is a queue; queues without an owner grow. Six months later the analytics engine's baselines
were fitted on the resolvable half, nobody knows which half that was, and there is no way
to re-run the missing Tuesdays because this is the one source whose schema the company does
not own and cannot replay (`technology.md:653-655`).

The same shape applies beyond POS: an enriched row with no verified producer, an annotated
document with an ambiguous label, a synthetic invoice degraded in a way no real scanner
produces. **Landed ≠ usable** is the department-wide version of the seam already drawn
between delivery and fitness (`technology.md:859`).

**Earliest observable signal.** Unresolved-queue depth increasing for two consecutive
close-times while ingest volume also increases — the two rising together is the tell. Also:
any single restaurant whose `pos.line_resolution_rate` sits more than 20 points below the
fleet median for two close-times, which a fleet average would completely conceal.

**Counter-pressure.** Every producing team's primary metric is defined on **fitness, not
volume**, and this is checked at charter level, not left to intent:
demand-weighted coverage (not records enriched), gold-set freshness (not annotations done),
backtest fidelity (not documents generated), line-resolution rate (not rows ingested).
Per-restaurant reporting is mandatory for POS — minimum and distribution, never mean.
And [[data-loops]] `unresolved-queue-drain` gives the review queue a named owner and a
close-time, because an unowned queue is the mechanism, not the symptom.

---

## Cross-cutting counter-pressure

- **The provenance invariant (M2) is the load-bearing one.** M1, M3, M4 and M5 are all
  survivable with honest reporting. A contaminated oracle is not survivable, because it
  destroys the ability to detect the other four.
- **Advisory is findings-only** ([[ORG_STRUCTURE]] §3). [[red-team-charter]] attacks the
  *decisions* here — the denominator choice (M1), the deferral of dish identity (M3), the
  threshold-change protocol (M4). [[architecture-review-charter]] owns the L0→L1..L6
  dependency rule, and a layer above L0 that has quietly built its own private corpus is
  its finding to make, not ours to notice.
- **[[decision-office-charter]] owns close-times.** Every mechanism above names one.
- **Anti-sprawl applies to this document.** If nothing here has been revisited in 60 days,
  it is fiction ([[README]] §3.3, §6).
