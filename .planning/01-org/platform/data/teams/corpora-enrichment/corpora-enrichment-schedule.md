---
type: schedule
division: platform
department: data
team: corpora-enrichment
status: provisional
metrics: [corpora.demand_weighted_coverage, corpora.field_confidence_median, corpora.source_canary_pass_rate, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-directive]]", "[[data-schedule]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[README]]"]
---

# Corpora & Enrichment — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Daily | Enrichment batch, drawn from `enrichment_demand_priority` | `nf_a.task_success_rate`, `nf_a.cost_per_task`, enriched rows |
| Daily | **Source canary run** across all 6 internet-facing services | `corpora.source_canary_pass_rate`; auto-removes a failing source |
| Daily | Per-corpus coverage line into the department substrate report | wine · beverage · food · producer, zeros included |
| Weekly | Demand queue re-sort from live restaurant inventory | Next week's batch order |
| Weekly | Depth-vs-cost pair review — median field confidence beside cost per record | Depth decision, if any |
| Weekly | Quarantine repair pass via `wine_repair_log` | Repaired rows **and** the prompt/pipeline change |
| Weekly | Source output-shape drift report | `corpora.source_output_shape_drift` |
| Monthly | Producer reputation top-up against new menu-corpus entries | `corpora.producer_reputation_coverage` |
| Quarterly | **Mandate review** — is beverage/food still in scope, funded, or dropped? | `OPEN-DECISIONS.md` entry |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. The at-risk entry here is the weekly source output-shape drift
report — it is the kind of report that becomes a green checkmark nobody reads. Its
downgrade path is weekly → monthly → replaced entirely by the canary run, which produces an
*action* (source removed) rather than a *number*.

## Skills owned

**None today.** `.claude/skills/` does not exist in this repo; the only project skill is
`.agents/skills/railway-config/SKILL.md` ([[README]] §3.1). The list below is a proposal
against a registry that has not been built ([[skill-registry-authoring-charter]]).

Each entry satisfies the §3.3 creation protocol — trigger, doneability criteria, a **real
past instance**, owning department:

| Skill | Tier | Trigger | Doneability criteria | Real past instance |
|---|---|---|---|---|
| `wine-enrichment` | T1 Domain | A demand-ordered batch of unenriched wines is available and capacity exists | Every row in the batch either reaches the minimum field set above the confidence gate, or is logged as *attempted* — never counted as enriched | `scripts/enrich_wines_insession.py` + `haiku_enrichment_service.py`; run for real in `ef19b81` (79 wines) and `8bbcde6` |
| `producer-research` | T1 Domain | An enriched wine has no producer reputation record | Producer record exists with a verifiable external citation, or the wine is flagged for the repair loop | `wine_research_service.py`, `wine_book_scraper.py`; `f7e0ea1` took the menu corpus to 100% |
| `menu-extraction` | T1 Domain | A menu PDF, photo or HTML snapshot lands in `datasets/annotation_inbox/` | Line items extracted with per-field confidence, written with `source_guarantee = scraped`, unresolved lines queued rather than guessed | `.planning/MENU_EXTRACTION_SCALE_PLAN.md`, `datasets/menu_corpus/` |
| `source-canary-check` | T3 Operational | Daily, and before any pipeline change touching an external source | Every source either passes its canary set or is removed from `enrichment.active_sources` in the same run | Written directly against [[corpora-enrichment-premortem]] M4; no past instance because the failure has not been caught yet — **flagged: this one is speculative and should not be authored until M4 fires once** |

**Honesty note:** the last row breaks §3.3 rule 3 (*cite a real past instance — no
speculative skills*). It is listed because M4 is the team's most under-defended mechanism,
and it is marked rather than quietly included. The correct sequence is: build the canary
sets by hand, catch one rotted source, **then** author the skill from what was actually done.

**Anti-sprawl:** a skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). [[skill-lifecycle-anti-sprawl-charter]] runs that review — this team
does not grade its own skills, for the same reason it does not grade its own rows.
