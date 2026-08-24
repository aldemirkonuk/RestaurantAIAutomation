---
type: premortem
division: platform
department: data
team: corpora-enrichment
status: provisional
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-directive]]", "[[data-premortem]]", "[[substrate-quality-coverage-charter]]", "[[annotation-ground-truth-charter]]", "[[red-team-charter]]", "[[technology]]"]
---

# Corpora & Enrichment — Premortem

> Written at founding, before success is assumed.

The team doc gives one line (`technology.md:591-594`): *coverage is chased on the full
library because the number moves faster there, the demand-weighted figure stagnates, and
the L0 blocker is declared solved while the wines on real menus are still thin.* That is
M1. Four more follow.

---

## M1 — The library number won, because it was the one that moved

144 of 1,448 wines are enriched. Every batch adds to that fraction, and the fraction is
easy to state. The demand-weighted figure needs a join against live restaurant inventory,
moves in fits, and can *fall* when a new restaurant onboards with a menu full of unenriched
bottles — which is a correct signal and an awful thing to report.

So the library number is what gets reported. It crosses 50%, the corpus is called healthy,
and the sommelier feature ships against menus whose bottles are still empty rows. The
failure is not detected because from inside the pipeline everything looks like progress:
records enriched, cost per record falling, success rate high.

**Earliest observable signal.** The **first** report of a coverage percentage with no
denominator named. Practically: any line reading "wine coverage: N%" that is not
immediately followed by "(demand-weighted: M%)". One occurrence, not a trend.

**Counter-pressure.** The charter's primary metric is the demand-weighted one and the
library figure is *never allowed to appear alone* ([[corpora-enrichment-charter]] §Metrics).
The queue is re-sorted weekly from `enrichment_demand_priority` output rather than
hand-picked ([[corpora-enrichment-loops]] loop 1) — so even if reporting slips, the *work*
stays demand-ordered. A new restaurant onboarding that drops the demand-weighted number is
published as a drop, with the explanation, on [[corpora-enrichment-agenda-board]].

---

## M2 — The pipeline optimised for records, and depth quietly collapsed

`corpora.library_coverage` counts rows that have *been through* enrichment. It does not
care whether the row came out with a region, a vintage, a producer, a critic score and a
verified web citation, or with a name and four nulls. Under cost pressure — and cost
pressure is real and documented, two years and $3,600 for the top 30%
(`…enrichment_demand_priority.sql:28`) — the cheapest way to move the number is to accept
shallower output: fewer research calls, skip `web_verification_service`, skip
`critic_score_service`, one Haiku pass and done.

Twelve months on, 900 wines are "enriched" and the median enriched row has three populated
fields. The corpus is wide and empty, and nothing in the coverage metric ever said so.

**Earliest observable signal.** `corpora.field_confidence_median` falling while
`corpora.library_coverage` rises. The two moving in opposite directions for a single
close-time is enough; this is a fast, cheap check and it is the whole reason the depth
metric exists.

**Counter-pressure.** Coverage is defined as **coverage at a stated depth**, not
coverage-at-any-depth: a row counts as enriched only when a named minimum field set is
populated with confidence above the [[substrate-quality-coverage-charter]] gate. Cost
savings are then visible as what they are — a depth decision — instead of appearing as
free productivity. `nf_a.cost_per_task` is published *next to* median field confidence, so
a falling cost that came from shallower work cannot be read as efficiency.

---

## M3 — Enrichment output leaked into the evaluation set

This is [[data-premortem]] M2 as it actually arrives, and it arrives *here*, because this
team is the only one producing rows fast enough to be tempting. A benchmark run is short of
examples. Enriched rows with confidence above 0.9 are, empirically, nearly always right.
Somebody tops up the set — reasonably, under time pressure, probably in a notebook — and
from that day the accuracy numbers measure agreement between the model and itself.

The scores go *up*. That is what makes it undetectable: a contaminated benchmark does not
look broken, it looks like a good quarter.

**Earliest observable signal.** Any benchmark or gold row with no `source_guarantee`, or
with `source_guarantee = scraped`. Also, second-order: a jump in benchmark accuracy that
does not correspond to any model, prompt or pipeline change — unexplained improvement is
suspicious in exactly the way unexplained regression is not.

**Counter-pressure.** This team **may not write to gold or benchmark sets at all**, by
decision right, not by convention ([[data-directive]]). The permission boundary is the
control; a policy asking people to remember would fail the first busy week.
[[substrate-quality-coverage-charter]]'s weekly provenance audit reports contaminated rows
as an absolute count and escalates on any non-zero value.

---

## M4 — Scrapers rotted silently and the corpus filled with confident garbage

Six of this team's services reach the open internet: `wine_book_scraper.py`,
`web_verification_service.py`, `auction_wine_service.py`, `critic_score_service.py`,
`wine_research_service.py`, plus whatever the enrichment prompts pull in. Sites change
layout without notice. A scraper that used to return a vintage now returns a cookie banner,
the LLM downstream is asked to extract a vintage from a cookie banner, and — being helpful —
it produces a plausible one. Nothing throws. Confidence stays high, because the model is
confident about the text it was given.

**Earliest observable signal.** A distributional break, not an error: extracted-field
*shape* changing for one source — e.g. vintages suddenly clustering on a narrow range, or
producer names getting shorter on average. Also the cheap version: any source whose
zero-result rate or output length shifts by more than a set band week-on-week.

**Counter-pressure.** Each external source is monitored as a **distribution, not an
uptime**: per-source output shape tracked weekly ([[corpora-enrichment-loops]] loop 3), with
a small per-source canary set of records whose correct answer is already known from
[[annotation-ground-truth-charter]]. A canary that starts failing takes the source out of
the pipeline rather than filing a ticket, because a broken scraper writes wrong rows every
hour it stays live, and those rows are expensive to find later.

---

## M5 — Wine ate the mandate, and "beverage, food and producer corpora" stayed a charter phrase

The mandate names four corpora. The evidence names ten wine services, four wine scripts, a
wine seed library, a wine demand migration and a wine-only enrichment input builder. Food
has a plan and a written-then-deferred design (`b728d25`). Beverage beyond wine has the
branch name this work sits on and little else.

Wine is where the tooling, the momentum and the domain expertise are. Every individual
decision to do more wine is correct. The aggregate is a team that has quietly redefined its
own mandate to a quarter of its stated scope, and the charter still says four corpora, so
nobody registers a decision was ever made.

**Earliest observable signal.** Three consecutive close-times where wine coverage moves and
dish/beverage coverage is **exactly zero** — flat, not slow. Also a documentation tell: the
first time the team's own board reports "coverage" as one number rather than per-corpus.

**Counter-pressure.** Per-corpus reporting is mandatory on
[[corpora-enrichment-agenda-board]] — wine, beverage, food, producer, four rows, always,
even when three of them are zeros. Zeros on a board are uncomfortable in a productive way;
an omitted row is not. Quarterly, the deferral is forced to a decision: **fund it or drop
it from the mandate** ([[data-directive]] escalation trigger 6). Dropping food from this
team's charter honestly is a perfectly good outcome. Carrying it as unfunded scope is not.

---

## Cross-cutting

- **M3 is the unsurvivable one.** M1, M2, M4 and M5 are detectable and repairable. A
  contaminated oracle removes the ability to detect the other four, and this team is the
  most likely point of entry.
- **[[red-team-charter]]** attacks the denominator decision (M1) and the depth definition
  (M2) — both are decisions, which is its scope ([[ORG_STRUCTURE]] §3).
- **60-day rule.** If nothing here has been revisited in 60 days it is fiction
  ([[README]] §3.3).
