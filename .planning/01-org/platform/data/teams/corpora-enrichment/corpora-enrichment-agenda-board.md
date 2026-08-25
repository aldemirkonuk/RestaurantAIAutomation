---
type: agenda-board
division: platform
department: data
team: corpora-enrichment
status: provisional
metrics: [corpora.demand_weighted_coverage, corpora.library_coverage, corpora.field_confidence_median, nf_a.cost_per_task]
updated: 2026-08-24
links: ["[[corpora-enrichment-charter]]", "[[corpora-enrichment-premortem]]", "[[corpora-enrichment-agenda-full]]", "[[corpora-enrichment-loops]]", "[[corpora-enrichment-schedule]]", "[[data-agenda-board]]"]
---

# Corpora & Enrichment — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc, type AS Artifact, status AS Status, updated AS Updated
FROM "01-org"
WHERE team = this.team
SORT type ASC
```

## Sibling producers — the other three truth guarantees

```dataview
TABLE WITHOUT ID
  file.link AS Unit, status AS Evidence, updated AS Updated
FROM "01-org"
WHERE department = this.department AND type = "charter" AND team != this.team
SORT file.name ASC
```

## Stale check — 60 days

```dataview
TABLE WITHOUT ID file.link AS Doc, updated AS "Last touched"
FROM "01-org"
WHERE team = this.team AND date(updated) < date(today) - dur(60 days)
```

## Coverage — per corpus, zeros included

- [ ] **wine** — demand-weighted: unmeasured · library: **144/1,448** (`ef19b81`)
- [ ] **beverage (non-wine)** — 0
- [ ] **food / dish** — 0; identity deferred (`b728d25`)
- [ ] **producer** — **100% on the menu corpus** (`f7e0ea1`) ← the one demand-weighted win

## Depth and cost — always published together

- [ ] `corpora.field_confidence_median` — no baseline
- [ ] `nf_a.cost_per_task` per enriched record — no baseline
- [ ] Cost curve of record (`…enrichment_demand_priority.sql:28-29`): top 15% ≈ $1,800 / 1yr · top 30% ≈ $3,600 / 2yr

## External source health — 6 internet-facing services

- [ ] `wine_book_scraper` · `web_verification_service` · `auction_wine_service`
- [ ] `critic_score_service` · `wine_research_service` · enrichment prompt retrieval
- [ ] No output-shape monitoring · no canary records ([[corpora-enrichment-premortem]] M4)

## Open

- [ ] "Enriched" has no minimum-depth definition
- [ ] Rows carry no `source_guarantee`
- [ ] Team still has write access to gold/benchmark sets — must be revoked ([[corpora-enrichment-premortem]] M3)
- [ ] Food corpus: fund-or-drop decision has no date
- [ ] `populate_embeddings.py` parked here by default (`technology.md:580-581`)
