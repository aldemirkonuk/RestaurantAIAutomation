---
type: schedule
division: platform
department: data
status: provisional
metrics: [corpora.demand_weighted_coverage, substrate.quarantine_rate, nf_a.task_success_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[data-charter]]", "[[data-loops]]", "[[data-directive]]", "[[data-agenda-board]]", "[[corpora-enrichment-schedule]]", "[[annotation-ground-truth-schedule]]", "[[synthetic-generation-simulation-schedule]]", "[[pos-operational-telemetry-ingest-schedule]]", "[[substrate-quality-coverage-schedule]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Data — Schedule & Skills

## Recurring work

| Cadence | Job | Owner | Emits |
|---|---|---|---|
| Daily | **Data substrate progress report** — three L0 numbers (wine · dish · sales) + quarantine rate ([[README]] §6) | Department | `nf_a.*`, [[data-agenda-board]] |
| Daily | Enrichment batch run, ordered by `enrichment_demand_priority` | [[corpora-enrichment-charter]] | `nf_a.task_success_rate`, `nf_a.cost_per_task` |
| Weekly | **Provenance integrity audit** — absolute count of rows with no `source_guarantee` | [[substrate-quality-coverage-charter]] | Escalation if > 0 |
| Weekly | Demand reprioritization — re-sort the enrichment queue from live sales | [[corpora-enrichment-charter]] | Queue order |
| Weekly | Unresolved POS line queue drain, **per restaurant** | [[pos-operational-telemetry-ingest-charter]] | `pos.line_resolution_rate` |
| Weekly | Gold-set freshness check — days since newest annotation, per task type | [[annotation-ground-truth-charter]] | `annotation.gold_set_freshness_days` |
| Monthly | Backtest fidelity — synthetic vs. real gold set (`scripts/docgen/backtest.py`) | [[synthetic-generation-simulation-charter]] | `synthetic.backtest_fidelity_gap` |
| Monthly | Threshold change review — quarantine rate **beside** threshold value | [[substrate-quality-coverage-charter]] | Decision record |
| Monthly | Agenda sync — full vs. board drift across all 5 teams ([[README]] §6) | Department | — |
| Quarterly | Deferral review — dish identity and anything else carrying no date | Department | `OPEN-DECISIONS.md` |

**Anti-sprawl rule ([[README]] §6):** a scheduled job that produces **no action for 3
consecutive runs** is downgraded or deleted. The daily substrate report is the most
at-risk entry here — a daily report nobody acts on becomes wallpaper faster than any other
artifact in this department. Its downgrade path is daily → weekly → deleted, and the
downgrade is automatic, not discretionary.

## Skills owned

**Honest state first: this department owns zero skills today.** `.claude/skills/` does not
exist in this repo. The only project skill anywhere is
`.agents/skills/railway-config/SKILL.md`, and root `SKILLS.md` is a prose reasoning
protocol, not a skill, still branded "WineOps AI" ([[README]] §3.1). Building the skill
layer here is close to greenfield, and everything below is a **proposal**, not an index.

Every entry must satisfy the §3.3 creation protocol before it is committed: name the
**trigger**, name the **doneability criteria**, cite a **real past instance**, declare the
**owning department**. No speculative skills — which is why each proposal below cites the
script or service it would be harvested from.

| Proposed skill | Tier ([[README]] §3.2) | Trigger | Harvested from — the real past instance |
|---|---|---|---|
| `wine-enrichment` | T1 Domain | A batch of unenriched wines reaches the top of the demand queue | `scripts/enrich_wines_insession.py`, `services/…/haiku_enrichment_service.py`; run live in `ef19b81`, `8bbcde6` |
| `menu-extraction` | T1 Domain | A new menu PDF/photo lands in `datasets/annotation_inbox/` | `.planning/MENU_EXTRACTION_SCALE_PLAN.md`, `datasets/menu_corpus/` |
| `producer-research` | T1 Domain | An enriched wine has no producer reputation record | `services/…/wine_research_service.py`, `wine_book_scraper.py`; `f7e0ea1` reached 100% producer coverage on the menu corpus |
| `substrate-progress-report` | T2 Department | Daily, or on demand before any external claim about L0 | The three-number rule; would have prevented [[data-premortem]] M1 and M3 |
| `provenance-audit` | T2 Department | Weekly, and before any gold-set or benchmark change | `active_learning_service.py:14-17` benchmark loop — the exact place M2 enters |
| `quarantine-triage` | T2 Department | Quarantine rate moves more than N points week-on-week | `…20260817030000_under_identified_quarantine.sql`, `wine_repair_log` |
| `pos-line-resolution-repair` | T1 Domain | Unresolved queue depth rises two close-times running | `…20260805133000_pos_unresolved_lines_and_review_queues.sql` |
| `synthetic-backtest` | T3 Operational | Any model change, before it is trusted | `scripts/docgen/backtest.py` |

**Anti-sprawl rule:** a skill that has not fired in **30 days** is reviewed for deletion
([[README]] §3.3). [[skill-lifecycle-anti-sprawl-charter]] runs that review; this
department does not grade its own skills, for the same reason it does not grade its own
rows.

**Registry note.** These are proposals against a registry that does not exist yet
([[skill-registry-authoring-charter]]). None should be authored before the intake contract
(`source_guarantee`) exists — a `wine-enrichment` skill that writes rows with no provenance
industrialises [[data-premortem]] M2 rather than the enrichment.
