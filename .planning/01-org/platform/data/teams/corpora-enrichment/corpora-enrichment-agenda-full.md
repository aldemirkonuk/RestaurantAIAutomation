---
type: agenda-full
division: platform
department: data
team: corpora-enrichment
status: provisional
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-premortem]]", "[[corpora-enrichment-agenda-board]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-directive]]", "[[corpora-enrichment-schedule]]", "[[data-agenda-full]]", "[[substrate-quality-coverage-charter]]", "[[annotation-ground-truth-charter]]"]
---

# Corpora & Enrichment — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact. The *pipeline* is
> running; the *team* is a charter. Nothing below is decided.

## What

Fill the wine, beverage, food and producer corpora with machine-generated,
confidence-scored facts — **in demand order**, at a stated depth, with provenance attached
to every row.

The pipeline exists and runs today. What does not exist:

- a coverage figure with an agreed denominator,
- a definition of "enriched" that includes a minimum depth,
- a `source_guarantee` on the rows it writes,
- per-source health monitoring for six internet-facing scrapers,
- any dish or non-wine beverage work at all.

## How

**Queue by demand, not by alphabet or by whatever is easy.**
`supabase/migrations/20260813170000_enrichment_demand_priority.sql` already does the hard
part: `demand_score` from live restaurant inventory, ordered *"sold recently > has sold >
the rest"* (`:103`). The work is to make sure the batch actually comes from that function
every time, and that the number reported comes from the same denominator.

**Cost is a design input, not an afterthought.** The migration's own arithmetic
(`:28-29`): top 30% by demand is 90,000 records, $3,600, two years; top 15% is 45,000,
$1,800, one year. The in-session enrichment approach (`8bbcde6`) exists because of that
math. Model routing belongs to [[model-routing-inference-economics-charter]] — this team
states the job and its required depth; it does not pick the cheapest model and call the
resulting shallowness a strategy ([[corpora-enrichment-premortem]] M2).

**Verify against something outside ourselves.** `web_verification_service.py` and
`critic_score_service.py` exist for this. They are also six of the ways this team's corpus
can silently fill with garbage when a scraped page changes shape (M4).

**Never touch the oracle.** This team writes to the corpus. It does not write to gold sets,
benchmark sets, or anything [[annotation-ground-truth-charter]] owns — enforced as a
permission, not a norm.

## Why now

- **The run is live.** `ef19b81` and `8bbcde6` are recent commits; batches are being
  selected right now, which means the denominator question is being answered implicitly
  today by whatever query picks the next batch.
- **Producer reputation already proved the model.** `f7e0ea1` reached **100% coverage on
  the menu corpus** — the one place demand-weighting was applied. That is the proof the
  approach works and the argument for applying it to the wine corpus too.
- **The `enrichment_demand_priority` migration is only days old** in repo terms and was
  written explicitly to reorder eligibility by demand. Using it is cheap now; retrofitting
  a year of coverage claims is not.

## Next steps

| # | Move | Blocks | Notes |
|---|---|---|---|
| 1 | Publish both coverage figures side by side; never the library one alone | M1 | Reporting change only, costs a day |
| 2 | Define "enriched" as a **minimum field set above the confidence gate** | M2 | Needs a line drawn with [[substrate-quality-coverage-charter]] |
| 3 | Attach `source_guarantee = scraped` to every written row | [[data-premortem]] M2 | Schema request to [[schema-migrations-charter]] |
| 4 | Revoke this team's write access to gold/benchmark sets | M3 | Permission, not policy |
| 5 | Per-source output-shape monitoring + canary records for all 6 external services | M4 | Canaries come from [[annotation-ground-truth-charter]] |
| 6 | Per-corpus board rows: wine · beverage · food · producer, zeros included | M5 | Makes the mandate drift visible |
| 7 | Take a baseline `nf_a.cost_per_task` per enriched record at current depth | M2 | Without it, "cheaper" is unfalsifiable |

## Questions for the founder

1. **What is the minimum field set** that makes a wine "enriched"? This team should not
   choose it alone — the answer determines both the coverage number and the cost per record.
2. **Food: fund or drop?** Dish identity is deferred with a written design (`b728d25`).
   Carrying it as unfunded scope is the mechanism in M5.
3. **How far down the demand curve** do we go before breadth beats depth — top 15%
   ($1,800, one year) or top 30% ($3,600, two years) per the migration's own numbers?
4. **`populate_embeddings.py`** sits here by default (`technology.md:580-581`). Is retrieval
   coming soon enough that this should be split out, or does it stay?
