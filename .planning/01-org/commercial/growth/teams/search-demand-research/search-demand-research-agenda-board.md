---
type: agenda-board
division: commercial
department: growth
team: search-demand-research
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[search-demand-research-charter]]", "[[search-demand-research-agenda-full]]", "[[search-demand-research-loops]]", "[[search-demand-research-schedule]]", "[[growth-agenda-board]]"]
---

# Search Demand Research — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth/teams/search-demand-research"
SORT type ASC
```

## Where this team sits in Growth

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  default(team, "— dept —") AS Unit,
  status AS Evidence,
  metrics AS "Primary metric(s)"
FROM "01-org/commercial/growth"
WHERE type = "charter"
SORT default(team, "") ASC
```

## Stale — untouched in 60 days is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/commercial/growth/teams/search-demand-research"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- [ ] `demand.uncovered_keyword_count` — **unmeasurable**: no Search Console property, no indexed page
- [ ] `demand.wedge_share_of_corpus` — **n/a**: no corpus. Read next to the primary metric, never alone
- [ ] `demand.queue_rejection_reasons` — **0 entries**. Zero rejections means nothing has been judged

## Blocking, in order

- [ ] **Intake finding not written** — Perplexity search-set retrievability, AnswerThePublic
      at volume, Search Console export limits. Unverified per [[commercial]] §7. **Not blocked
      on anything; this is the first task**
- [ ] **Brief format undrafted** — the queue's unit is a brief, not a term
- [ ] **Wedge definition not fixed** — needed from [[narrative-collateral-charter]] before
      tagging can mean anything
- [ ] **L-GRO-1 precondition unmet** — `seo.soft_404_rate` is **100%**
      (`vercel.json:11-13` → `apps/web/src/App.tsx:302`); a query report from this site is an
      artefact, not demand
- [ ] **No credentials of any kind** — `env.example` (187 lines) has no key for any of the three sources

## Standing prohibitions

- [ ] No harvesting at volume before the brief format exists
- [ ] No term commissioned without a wedge tag
- [ ] No target-account or ICP list — founder-deferred, and not sketched here
- [ ] No paid keyword work — no budget, no pricing ([[commercial]] §1.4)
