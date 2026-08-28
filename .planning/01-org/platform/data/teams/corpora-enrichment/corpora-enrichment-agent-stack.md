---
type: agent-stack
division: platform
department: data
team: corpora-enrichment
status: designed
updated: 2026-08-27
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, nf_a.task_success_rate, nf_a.cost_per_task]
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-schedule]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-directive]]", "[[corpora-enrichment-premortem]]", "[[0034-agent-stack-artifact]]", "[[data-agent-stack]]", "[[substrate-quality-coverage-agent-stack]]", "[[skills-charter]]"]
---

# Corpora & Enrichment — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This is the department's **only team with a live agent workload today** and its largest NF-A
> emitter. Its card is therefore the one most at risk of being read as running: the *pipeline*
> exists and has been run for real; the *agent contract* on this page has not.
> Model choice and cost routing stay with [[model-routing-inference-economics-charter]] — this
> team states the job, they price it ([[corpora-enrichment-charter]] §Non-goals).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `enrichment-runner` | Take the top of the demand-ordered queue, produce confidence-scored facts about real bottles and producers, and log every attempt that did not clear the bar as *attempted* rather than as coverage | PARTIAL `services/agent-orchestrator/services/haiku_enrichment_service.py`, `scripts/enrich_wines_insession.py` — the pipeline exists and ran (`ef19b81`, `8bbcde6`); the card does not |

## 2. Agent cards

```yaml
agent: enrichment-runner
unit: corpora-enrichment
triggers:
  - schedule: "daily enrichment batch, drawn from enrichment_demand_priority"   # mirrored in [[corpora-enrichment-schedule]]
  - schedule: "weekly demand queue re-sort from live restaurant inventory"
  - topic: substrate.row_quarantined                # publisher: [[substrate-quality-coverage-agent-stack|substrate-auditor]] (designed) via `wine_repair_log`
consumes:
  - "the demand-ordered eligibility list — publisher: `supabase/migrations/20260813170000_enrichment_demand_priority.sql:80-95` (exists)"
  - "`sales.density` / demand_score inputs — publisher: [[pos-operational-telemetry-ingest-agent-stack|pos-fitness-monitor]] (PARTIAL — the sales corpus is thin)"
  - "the seed library and raw corpora — `data/master_wine_library_seed.json`, `datasets/{wine_labels,wine_menus,wine_invoices,menu_corpus,scraped}/`"
  - "canary sets — publisher: [[annotation-ground-truth-agent-stack|gold-set-steward]] (designed, monthly top-up)"
emits:
  - "enriched rows carrying per-field confidence — consumer: [[substrate-quality-coverage-agent-stack|substrate-auditor]]'s gate (`governance.py:107`)"
  - "candidate facts for identity — consumer: [[catalogue-identity-charter]]"
  - 'nf_a events (task_type: corpus_enrichment) — consumer: [[data-agent-stack|data-l0-rollup]]'
routing_class: extraction        # pull a defined field set out of sources; the field set is fixed, the sources are not
quality_bar: "another unit's gate: `governance.py:107` assign_governance_tier + `:227` compute_overall_confidence, published by [[substrate-quality-coverage-charter]]. This agent never grades its own output (author ≠ auditor, `technology.md:32-34`)"
autonomy:
  read: autonomous
  propose: autonomous
  mutate_stock_money_outbound: confirm   # constant
memory: corpora-enrichment
escalates_to: "[[data-charter]]"
```

**The card's two hard rules.** (1) Every row it writes carries its `source_guarantee`; a row
without one is not a cheaper row, it is [[data-premortem]] M2. (2) It may **never** write into a
gold set or promote its own output ([[data-directive]] decision rights) — however confident the
field confidence is. Both are in the card because both are one convenience function away.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `wine-enrichment` | T1 | A demand-ordered batch is available and capacity exists | Every row in the batch reaches the minimum field set above the confidence gate **or** is logged as *attempted* — never counted as enriched; cost per record emitted beside coverage | `ef19b81` — 79 wines enriched in-session to 144/1,448; `8bbcde6` moved the backfill in-session instead of onto API credits | NEW |
| `producer-research` | T1 | An enriched wine has no producer reputation record | Producer record exists with a verifiable external citation, or the wine is flagged into the repair loop | `f7e0ea1` — producer reputation reached 100% on the menu corpus, the one place demand-weighting was actually applied | NEW |
| `menu-extraction` | T1 | A menu PDF, photo or HTML snapshot lands in `datasets/annotation_inbox/` | Line items extracted with per-field confidence and `source_guarantee = scraped`; unresolved lines queued, never guessed | `datasets/menu_corpus/` exists and `f7e0ea1` ran against it — menus have been extracted at least once. **Weakest row here:** the corpus is the artifact, the run is not recorded, and `MENU_EXTRACTION_SCALE_PLAN.md` is unexecuted with dish identity deferred (`b728d25`) | NEW |

**Deliberately absent: `source-canary-check`.** [[corpora-enrichment-schedule]] lists it and
flags it as breaking §3.3 rule 3 — no past instance, because the failure it defends against
([[corpora-enrichment-premortem]] M4, silently rotted scrapers) has not been caught yet. It is
dropped from this table rather than carried as an aspiration. Correct sequence, unchanged: build
the canary sets by hand, catch one rotted source, **then** author the skill from what was done.

Consumed, owned elsewhere: [[skills-charter]] (envelope), [[substrate-quality-coverage-charter]]
(the grade), [[model-routing-inference-economics-charter]] (which model, at what price).

## 4. Memory

- **Procedural** — the three §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: corpus_enrichment`, the department's only live family today.
  Needs `context.corpus` (wine · beverage · food · producer), `context.source_guarantee`,
  `context.demand_score` and `context.source_id` as jsonb keys — without the last one, a rotted
  external source cannot be traced back through the rows it poisoned.
- **Semantic** — `memory/` beside this file, `corpora-enrichment-MEMORY.md` as index. Founding
  facts: the demand-vs-library denominator (`…enrichment_demand_priority.sql:28-31`), the
  cost-per-record finding that made full-library enrichment a two-year plan (`:28-29`), and each
  source's known output shape. Provenance frontmatter per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate, and **the current batch only**.
  The seed library and the scraped corpora are retrieval targets by key, never preloaded.

**Consolidation** — monthly, mirrored in [[corpora-enrichment-schedule]]: read the enrichment
NF-A slice; **failures first** — every quarantined class becomes a fact naming the mechanism
(which source, which field, which prompt), not "quality dipped", because the repair loop's
doneability is a *rule* change and a fact about a symptom cannot produce one; expire facts
unverified for 90 days; propose skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Loops ([[corpora-enrichment-loops]]: `enrichment-demand-reprioritization`,
`enrichment-depth-cost`, `external-source-canary`, `enrichment-repair`), NF-A events, and vault
PRs. Never a synchronous call to a sibling. Gap rows:

| Gap | Why it is a gap |
|---|---|
| `source_guarantee` has no intake contract | [[data-schedule]]'s registry note is explicit: nothing should be authored before it exists. Every emit line above depends on a column the vault says is not built |
| `substrate.row_quarantined` has no publisher | The quarantine tables exist (`…20260817030000_under_identified_quarantine.sql`); nothing notifies. The weekly repair pass bounds the blind spot at one close-time |
| Nobody is named as publisher of `datasets/annotation_inbox/` | Both this team and [[annotation-ground-truth-charter]] *consume* the inbox; no unit in the vault owns filling it |
| Canary sets have a designed supplier and no built consumer | [[annotation-ground-truth-schedule]] commits to the monthly top-up; the skill that would use them is the one dropped in §3 |

## 6. Evidence today

- **EXISTS — the pipeline the agent would drive.** `scripts/{enrich_wines,enrich_wines_insession,load_enriched_wines,build_wine_only_enrichment_input,populate_embeddings}.py`;
  `services/agent-orchestrator/services/{haiku_enrichment_service,wine_research_service,wine_book_scraper,critic_score_service,web_verification_service,auction_wine_service}.py`;
  the demand migration (function + index at `:112-114`). Live in history: `ef19b81`, `f7e0ea1`, `8bbcde6`.
- **PARTIAL — the NF-A tie.** Enrichment emits `nf_a.task_success_rate` and `nf_a.cost_per_task`
  ([[corpora-enrichment-charter]] §Metrics); the `context.*` keys §4 asks for do not exist.
- **NEW — the card, all three skills, and every memory layer.** Also NEW: the food half of the
  mandate, which the charter keeps as a **funded-or-dropped question**, not work in progress.
