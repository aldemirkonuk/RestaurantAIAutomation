---
type: charter
division: platform
department: data
team: corpora-enrichment
status: exists
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, nf_a.task_success_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-premortem]]", "[[corpora-enrichment-agenda-full]]", "[[corpora-enrichment-agenda-board]]", "[[corpora-enrichment-directive]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-schedule]]", "[[data-charter]]", "[[annotation-ground-truth-charter]]", "[[synthetic-generation-simulation-charter]]", "[[pos-operational-telemetry-ingest-charter]]", "[[substrate-quality-coverage-charter]]", "[[catalogue-identity-charter]]", "[[technology]]", "[[README]]"]
---

# Corpora & Enrichment — Charter

Parent: **Data** ([[data-charter]]), division **Platform**. Team §5.1 in
`.planning/foundation/teams/technology.md:563`.

## Mandate

This team owns the **coverage and depth of the wine, beverage, food and producer corpora,
and the machine enrichment pipeline that fills them** (`technology.md:565-566`). It is the
volume producer of L0: everything it emits is a machine-generated, confidence-scored fact
about a real-world object that nobody on this team has held in their hand.

## Why it is distinct from its siblings

It produces **probabilistic facts at scale — machine-generated, confidence-scored, never
an oracle** (`technology.md:568-569`).

That sentence is the boundary. [[annotation-ground-truth-charter]] produces small amounts
of verified truth; this team produces large amounts of good guesses. Both are necessary and
they are **categorically different substances**. The single most damaging thing this team
can do is let its output be treated as ground truth — which is why it does not own its own
grade ([[substrate-quality-coverage-charter]] does) and may never promote a row of its own
into a gold set ([[data-directive]] decision rights).

## Boundaries

Owns outright:

- **The enrichment pipeline** — `scripts/enrich_wines.py`, `scripts/enrich_wines_insession.py`,
  `scripts/load_enriched_wines.py`, `scripts/build_wine_only_enrichment_input.py`.
- **The enrichment services** — `services/agent-orchestrator/services/haiku_enrichment_service.py`,
  `wine_research_service.py`, `wine_book_scraper.py`, `critic_score_service.py`,
  `web_verification_service.py`, `auction_wine_service.py`.
- **The seed library and raw corpora** — `services/agent-orchestrator/data/master_wine_library_seed.json`;
  `datasets/{wine_labels,wine_menus,wine_invoices,menu_corpus,scraped}/`.
- **Queue order** — the enrichment queue is produced by
  `supabase/migrations/20260813170000_enrichment_demand_priority.sql`, and the team owns
  keeping it pointed at that function rather than at a hand-picked batch.
- **Producer reputation coverage** — `.planning/07-reference/PRODUCER_REPUTATION_PLAN.md`; reached 100%
  on the menu corpus in `f7e0ea1`.
- **Menu extraction at scale** — `.planning/07-reference/MENU_EXTRACTION_SCALE_PLAN.md`.
- **Embeddings, for now** — `scripts/populate_embeddings.py` is one script and sits inside
  this team **deliberately, until retrieval work justifies otherwise**
  (`technology.md:580-581`). Recorded here so the decision to split it later is a decision,
  not a drift.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Grading our own output | [[substrate-quality-coverage-charter]] | Author ≠ auditor (`technology.md:32-34`) |
| Promoting any row to gold | [[annotation-ground-truth-charter]] | An enriched row is never an oracle, however confident |
| Generating data with a known answer | [[synthetic-generation-simulation-charter]] | We guess about real bottles; they construct fictional ones |
| What the product calls a product — merge rules, identity resolution | [[catalogue-identity-charter]] | We supply candidate facts; Engineering decides identity |
| Training any model on our output | Research & Math *(Intelligence)* | (`technology.md:613-616`) |
| Model choice and cost routing for enrichment calls | [[model-routing-inference-economics-charter]] | We state the job; they price it |

## Metrics it moves

**Primary: `corpora.demand_weighted_coverage`** — the share of wines **actually appearing
on customer menus** that are enriched, not the share of the library
(`technology.md:585-589`). The distinction is already encoded in SQL:
`…enrichment_demand_priority.sql:80-95` computes `demand_score` from live restaurant
inventory and orders eligibility by it, with the explicit note that *"eligibility is now
ordered by demand first"* (`:31`).

Secondary, and never permitted to appear alone:

- `corpora.library_coverage` — **144/1,448 today** (`ef19b81`). This is the flattering
  number and the wrong one to optimize.
- `corpora.field_confidence_median` — depth, not just presence. A row with a name and
  nothing else is coverage without content.
- `corpora.producer_reputation_coverage` — 100% on the menu corpus (`f7e0ea1`), which is
  the one place demand-weighting has already been applied and worked.

**Neural-footprint tie.** Enrichment is agent work and is the department's largest NF-A
emitter: `nf_a.task_success_rate` and `nf_a.cost_per_task` per enriched record. The demand
migration exists *because* cost-per-record made full-library enrichment a two-year plan
(`…enrichment_demand_priority.sql:28-29`) — cost is not a footnote here, it is the reason
the team's primary metric has the denominator it has.

## Evidence today

**EXISTS — and actively running.** This is the strongest evidence base in the department
(`technology.md:571-581`), re-verified 2026-08-24.

- Scripts present: `scripts/{enrich_wines,enrich_wines_insession,load_enriched_wines,build_wine_only_enrichment_input,populate_embeddings}.py`
- Services present: `services/agent-orchestrator/services/{haiku_enrichment_service,wine_research_service,wine_book_scraper,critic_score_service,web_verification_service,auction_wine_service}.py`
- Datasets present: `datasets/{wine_labels,wine_menus,wine_invoices,menu_corpus,scraped}/`
- Demand prioritization present: `supabase/migrations/20260813170000_enrichment_demand_priority.sql`
  (function returns `demand_score`, indexed at `:112-114`)
- Plans present: `.planning/07-reference/PRODUCER_REPUTATION_PLAN.md`, `.planning/07-reference/MENU_EXTRACTION_SCALE_PLAN.md`
- Live in git history: `f7e0ea1 data(producer-reputation): reach 100% coverage on the menu
  corpus`, `ef19b81 data(a10): enrich 79 more wines in-session (144/1,448)`,
  `8bbcde6 feat(enrich): run the wine backfill in-session instead of on API credits`

**Thin, and stated as thin:** the *food* half of the mandate. `datasets/menu_corpus/` and
`MENU_EXTRACTION_SCALE_PLAN.md` exist; dish identity was explicitly deferred with its design
written (`b728d25`). The charter claims wine and beverage as running work and food as a
**funded-or-dropped question**, not as work in progress ([[data-premortem]] M3).
