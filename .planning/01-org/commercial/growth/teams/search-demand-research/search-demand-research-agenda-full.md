---
type: agenda-full
division: commercial
department: growth
team: search-demand-research
status: provisional
metrics: [demand.uncovered_keyword_count, demand.wedge_share_of_corpus]
updated: 2026-08-24
links: ["[[search-demand-research-charter]]", "[[search-demand-research-premortem]]", "[[search-demand-research-loops]]", "[[search-demand-research-directive]]", "[[search-demand-research-schedule]]", "[[search-demand-research-agenda-board]]", "[[growth-agenda-full]]", "[[content-production-charter]]", "[[technical-seo-ai-answer-surface-charter]]", "[[narrative-collateral-charter]]", "[[OPEN-DECISIONS]]"]
---

# Search Demand Research — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Three things, in this order, and the first one is not harvesting.

1. **A written finding on whether the three intakes are actually usable.** Perplexity's
   search set, AnswerThePublic at volume, Search Console export limits. This has never been
   checked ([[commercial]] §7) and the whole pipeline's throughput depends on the answer.
2. **The brief format.** The queue's unit is a brief, not a term. Getting this wrong
   produces a four-hundred-row list nobody can act on ([[search-demand-research-premortem]]
   M3).
3. **The corpus itself**, harvested topic by topic, wedge-tagged at intake.

## How

**The intake finding (item 1).** For each of the three sources, answer four questions in
writing: is the data retrievable programmatically, at what volume, at what cost, and if the
answer is manual, how many topics per week does one person sustain? A manual answer is a
perfectly good answer — it just has to become a **number** that
[[content-production-charter]]'s commission rate is set against, rather than an unspoken
cap.

**The brief format (item 2).** One brief per queue entry:

| Field | Why it is there |
|---|---|
| Primary query | The one thing the page answers |
| Harvested search set | The exact queries the research session ran. This is the corpus, per the founder's specification |
| Ten distinct questions | From AnswerThePublic. Distinctness decided here, before drafting, never discovered later as duplicate content |
| Wedge tag | Inside or outside the beverage-invoice wedge, with a reason if outside |
| Who is asking, and what they are trying to do | One line. If it cannot be written, the term is rejected, not queued |
| Priority and claim date | Ordering is the product. An unordered queue is a list |

A term that cannot fill this out is **rejected with a recorded reason** and counted in
`demand.queue_rejection_reasons`. Rejection is an output.

**The corpus (item 3).** Harvest during research, not after: the searches a session ran are
gone once the session's context is discarded, and reconstructing them from memory produces a
plausible list rather than the real one. That distinction is the entire value of the
founder's step 1.

**On the Search Console loop.** It does not start when the account is created. It starts
when [[technical-seo-ai-answer-surface-charter]] reports `seo.soft_404_rate` at zero and a
sitemap is being read, because a query report from a site where every URL returns HTTP 200
is an artefact of a defect, not a demand signal ([[search-demand-research-premortem]] M4).

## Why now

- **The corpus is the only Growth asset that compounds.** Everything else in the department
  is consumed on publication. Starting the corpus late costs more than starting anything
  else late, and starting it *wrong* costs a year.
- **The intake finding is free and blocking.** It requires no engineering, no budget, and no
  publishing target, and its answer sets the pipeline's maximum throughput. It is the one
  piece of G1's work that is not blocked on the rest of Growth.
- **The wedge is being decided right now, elsewhere.** [[narrative-collateral-charter]] is
  choosing the headline claim; [[YC_WEDGE_PLAN]]:323 argues that surface area is this repo's
  largest risk. A corpus built before the wedge is fixed will encode whatever the company
  was ambivalent about at the time.

## Next steps

1. Write the intake finding. Three sources, four questions each, one page.
2. Draft the brief format and fill it in **once**, completely, for a single topic — the
   invoice-discrepancy topic, since it is the wedge and the evidence exists.
3. Take the wedge definition from [[narrative-collateral-charter]] rather than inventing one.
4. Record the L-GRO-1 precondition with [[technical-seo-ai-answer-surface-charter]] so both
   teams agree the loop is blocked rather than late.
5. Do not harvest at volume until steps 1 and 2 are done. A corpus in the wrong format is
   worse than no corpus, because it will be defended.

## Questions for the founder

1. **Which Perplexity surface?** The consumer app, or the API? The search set may only be
   visible in one of them, and the answer decides whether step 1 is automatable.
2. **Is the wedge fixed?** G1 needs the beverage-invoice wedge stated as a boundary it can
   tag against. If it is still open, the corpus should stay small deliberately.
3. **English only?** The design partner is a Turkish restaurant in San Francisco. Whether
   the corpus includes non-English demand changes the harvest, the tooling, and the gate.
4. **Volume expectation.** If the intake finding says one topic per week is the sustainable
   manual rate, is that acceptable, or does it change the tooling budget? Growth will not
   quietly build a queue larger than the gate can consume.
