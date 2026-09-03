---
type: charter
division: platform
department: data
status: exists
metrics: [corpora.demand_weighted_coverage, annotation.gold_set_freshness_days, synthetic.backtest_fidelity_gap, pos.line_resolution_rate, substrate.quarantine_rate, nf_a.task_success_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[data-premortem]]", "[[data-agenda-full]]", "[[data-agenda-board]]", "[[data-directive]]", "[[data-loops]]", "[[data-schedule]]", "[[ORG_STRUCTURE]]", "[[technology]]", "[[README]]", "[[corpora-enrichment-charter]]", "[[annotation-ground-truth-charter]]", "[[synthetic-generation-simulation-charter]]", "[[pos-operational-telemetry-ingest-charter]]", "[[substrate-quality-coverage-charter]]", "[[engineering-charter]]", "[[reliability-sre-charter|reliability-charter]]"]
---

# Data — Charter

Parent division: **Platform** ([[ORG_STRUCTURE]] §2). Siblings in-division: Engineering,
Reliability/SRE.

## Mandate

Data is accountable for **L0 — the data substrate, and the layer the foundation names as
the blocker** ([[README]] §1: *"⚠️ The named blocker (vision §7). Wine enrichment in
progress; food + sales thin"*). Every layer above it is a consumer: L1's catalogue and
producer reputation, L2's Invoice Understanding and Floor Checker, L3's agents, L4's
footprint, L6's screens. None of them can be more right than the rows underneath them.
The department owns the wine, beverage, food and producer corpora; the human-verified
gold sets; the synthetic generators and their answer keys; the ingest of real operational
traffic from restaurant POS systems; and the measurement of whether any of it is fit to
publish. It does **not** own the models that reason over the substrate, the product
surfaces that display it, or the schema those surfaces read through.

**One distinction this charter insists on:** the *machinery* exists and is running — that
is why this charter is graded EXISTS. The *substrate* is thin. Those are different claims
and the department must never let the first be reported as the second. 144 of 1,448 wines
are enriched (`ef19b81`); food and sales are thinner still.

## Boundaries

Owns outright:

- **The four producing sources of L0**, split by the only line that matters — the
  **truth guarantee each one carries** (`technology.md:555-560`):

| Team | Truth guarantee | What that means when it is wrong |
|---|---|---|
| [[corpora-enrichment-charter]] | **Probabilistic** — machine-generated, confidence-scored | Plausible-looking wrong facts, at scale |
| [[annotation-ground-truth-charter]] | **Human-verified** — the oracle | Small, expensive, and stale before you notice |
| [[synthetic-generation-simulation-charter]] | **True by construction** — the answer key was written first | Unlimited, and unrepresentative in a way scores cannot show |
| [[pos-operational-telemetry-ingest-charter]] | **Observed** — true, but unowned and unrepeatable | A missed Tuesday is missing forever |

- **The auditor of all four** — [[substrate-quality-coverage-charter]]: confidence
  scoring, governance tiers, quarantine, and the daily substrate report ([[README]] §6).
  It is split from the producers on the same author≠auditor grounds the advisory layer
  uses ([[ORG_STRUCTURE]] §3, `technology.md:32-34` test 3). A producer that grades its
  own output has no grade.

- **Provenance as a first-class property.** Because four incompatible truth guarantees
  live in one department, every row must carry which one it came from. This is the
  department's single most important invariant and the subject of [[data-premortem]] M2.

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| Model training itself — `training/train_{invoice,label,menu}_scanner.py` | Research & Math *(Intelligence)* | We assemble training sets; they fit models (`technology.md:613-616`) |
| Webhook delivery health — signatures, retries, 200s, drops | [[integration-engineering-charter]] | Delivered correctly vs. **usable as L0** (`technology.md:859`) |
| Grading **agent tasks** | [[agent-evaluation-gates-charter]] | They grade task outcomes; [[substrate-quality-coverage-charter]] grades **data rows** (`technology.md:862`) |
| The catalogue, identity resolution, dedup rules in the product | [[catalogue-identity-charter]] | We supply candidate facts; Engineering owns what the product calls a product |
| The metrics *narrative* — dashboards, BI, the story told to customers | Analytics & BI *(Intelligence)* | Data owns the substrate; Analytics owns what is said about it ([[ORG_STRUCTURE]] §2) |
| Schema authorship for the tables we fill | [[schema-migrations-charter]] | We request columns; they author DDL |
| Consent and lawful basis for guest-derived data | Compliance & Privacy *(Corporate)* | We hold `nf_b.*` inputs; they hold the right to hold them |

## Metrics it moves

Data does **not** roll five team metrics into one L0-percent-complete figure, and the
refusal is the point: a single number is exactly how [[data-premortem]] M1 and M3 happen.
The department metric is the **set**, each with a named owner and a stated denominator:

- `corpora.demand_weighted_coverage` — share of wines **appearing on customer menus** that
  are enriched. Not share of library. `supabase/migrations/20260813170000_enrichment_demand_priority.sql:28-31`
  already encodes the distinction; 144/1,448 is the wrong ratio to optimize (`technology.md:585-589`).
- `annotation.gold_set_freshness_days` — days since the newest annotated example, per task
  type. A gold set that stops growing stops detecting drift.
- `synthetic.backtest_fidelity_gap` — |score on synthetic − score on real gold set|.
- `pos.line_resolution_rate` — reported **per restaurant**, minimum and distribution, never
  fleet mean.
- `substrate.quarantine_rate` — reported **beside the threshold value that produced it**.

**Neural-footprint tie.** Enrichment is agent work: `haiku_enrichment_service.py` and the
in-session enrichment runs emit `nf_a.task_success_rate` and `nf_a.cost_per_task`, and the
demand-priority migration exists because cost-per-record made full-library enrichment a
two-year plan (`…enrichment_demand_priority.sql:28-29`). On the guest side, `nf_b.*` is
downstream of this department twice over — a POS check line that does not resolve to a
catalogue item is a guest choice that was never recorded.

## Evidence today

**EXISTS — machinery running, substrate thin.** Graded per team; sources are
`technology.md:563-704`, re-verified in this repo on 2026-08-24.

- **Enrichment (EXISTS, running).** `scripts/enrich_wines.py`, `scripts/enrich_wines_insession.py`,
  `scripts/load_enriched_wines.py`, `scripts/build_wine_only_enrichment_input.py`;
  `services/agent-orchestrator/services/{haiku_enrichment_service,wine_research_service,wine_book_scraper,critic_score_service,web_verification_service,auction_wine_service}.py`;
  live progress in git history (`ef19b81`, `f7e0ea1`).
- **Annotation (EXISTS).** `datasets/annotation_tasks/{pdfs,pilot_test,pilot_test_v2,screenshots}.json`,
  `datasets/annotated/{invoices,menus}/`, `datasets/annotation_inbox/{classified,html_snapshots,pdfs,screenshots}/`;
  `scripts/prepare_annotation_tasks.py`, `scripts/start_label_studio.sh`,
  `docker/label-studio/docker-compose.yml`; correction loop at
  `services/agent-orchestrator/services/active_learning_service.py:14-17`.
- **Synthetic (EXISTS, unusually complete).** `scripts/synth/` (9 modules),
  `scripts/docgen/` (11 modules incl. `truth.py`, `degrade.py`, `backtest.py`),
  `scripts/simulate/` (7 modules); `datasets/sim/{archetypes,documents,menus}` + `manifest.json`.
- **POS ingest (EXISTS pipes / PARTIAL corpus).**
  `supabase/migrations/20260805133000_pos_unresolved_lines_and_review_queues.sql`,
  `…20260805132000_counting_catalog_and_correlation_columns.sql`;
  `apps/api-gateway/src/{pos-hub,toast,simpos}/` (10/10/11 routes).
  Sales metrics remain thin ([[README]] §1) — the pipes exist, the corpus does not.
- **Quality (EXISTS).** `supabase/migrations/20260813100000_library_data_quality_check.sql`,
  `…20260813130000_data_quality_confidence.sql`, `…20260814000000_data_quality_rescale.sql`,
  `…20260817030000_under_identified_quarantine.sql`, `…20260813120000_wine_repair_log.sql`;
  `services/agent-orchestrator/services/governance.py:20,53,107,227`;
  `quality_scorer.py`, `field_confidence.py`, `ontology_validation_service.py`;
  `datasets/OCR_CONFIDENCE_REPORT.md`.

**Where the evidence is genuinely thin, stated plainly:**

- **Food/dish corpus.** `datasets/menu_corpus/` and `.planning/07-reference/MENU_EXTRACTION_SCALE_PLAN.md`
  exist, but dish identity was **explicitly deferred** (`b728d25 docs(a15): defer dish
  identity, but write the design before deferring`). The L0 blocker is named as *wine and
  food*; only wine is being worked.
- **Sales metrics.** PARTIAL by the team doc's own grade. `apps/api-gateway/src/analytics/`
  (39 routes) consumes a substrate that is not yet dense.
- **Skills.** The department owns no skill today. `.claude/skills/` does not exist in this
  repo; the only project skill anywhere is `.agents/skills/railway-config/SKILL.md`
  ([[README]] §3.1). Everything in [[data-schedule]] under "skills owned" is a proposal.

## On five teams — is that too many?

Five is the highest justified count outside Engineering (`technology.md:551-553`), and the
justification holds: the four producers fail in four unrelated ways and cannot be merged
without losing the provenance distinction that makes every downstream eval meaningful.

**One honest reservation, recorded rather than buried.**
[[substrate-quality-coverage-charter]] is the only team here that ships nothing. Its
independence is worth its cost **only if its findings can actually stop a publish**. If
the quarantine gate is advisory in practice — a dashboard the producers glance at — the
team is overhead and should be merged back as a function inside the producers, with the
audit role handed to an advisory function instead. This is the department's own version of
the author≠auditor test, applied to the auditor. Reviewed at the first close-time where a
coverage milestone and a threshold change land together ([[data-premortem]] M4).

## Open forks touching this department

- **TECH-F1** — 25 teams for one division at all; Data is one of the two departments the fork
  names as plausibly exceeding one owner (`technology.md:843`).
- **TECH-F5** — Does the team layer get all 7 artifacts, or 3 (charter · premortem · loops)?
  This vault currently answers "7"; the fork is not closed (`technology.md:847`).
- **Seam, already drawn** — webhook health vs. data fitness
  ([[integration-engineering-charter]] ↔ [[pos-operational-telemetry-ingest-charter]]) and
  grading agents vs. grading rows ([[agent-evaluation-gates-charter]] ↔
  [[substrate-quality-coverage-charter]]), both at `technology.md:859-862`.
