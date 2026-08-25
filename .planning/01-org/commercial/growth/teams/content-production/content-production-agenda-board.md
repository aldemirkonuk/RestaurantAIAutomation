---
type: agenda-board
division: commercial
department: growth
team: content-production
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[content-production-charter]]", "[[content-production-agenda-full]]", "[[content-production-loops]]", "[[content-production-schedule]]", "[[growth-agenda-board]]"]
---

# Content Production — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/commercial/growth/teams/content-production"
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
FROM "01-org/commercial/growth/teams/content-production"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## Numbers

- [ ] `content.published_units_per_week` — **0**, and correctly 0: no publishing target exists
- [ ] `content.first_pass_clear_rate` — **n/a**: nothing submitted to the gate
- [ ] `content.faq_orphan_pages` — **0**, trivially: no answer pages exist. Counts missing
      back-links **and** duplicate-intent pairs in one number
- [ ] `nf_a.cost_per_task` for drafting — **not emitted**. The insertion point exists at
      `services/agent-orchestrator/services/spend_logger.py`; the doneability half is the gate's verdict

## Blocking, in order

- [ ] **No publishing target** — department decision, [[growth-agenda-full]] item 1
- [ ] **Content repository shape undecided** — files in-repo vs CMS. Affects whether a gate
      bypass is visible in version control
- [ ] **Both templates undrafted** — long-form and ~120-word answer
- [ ] **No voice guide** — [[brand-identity-charter]] owns it; until it exists the gate
      enforces an opinion
- [ ] **No brief** — waiting on [[search-demand-research-charter]]'s brief format
- [ ] **Shell brand is wrong** — `apps/web/index.html:7` still reads `WineOps AI`

## Standing rules on this board

- [ ] Throughput is capped at gate throughput. A draft queue deeper than two weeks is an
      intake problem, not a gate problem
- [ ] The article publishes and indexes **before** its ten answer pages ship
- [ ] Every long-form unit carries at least one thing this company knows and the internet
      does not ([[content-production-premortem]] M3)
- [ ] Ten questions is not a quota. Eight distinct questions is a valid answer set
- [ ] No draft implies a price, a tier, or a "starting at" — founder-deferred
- [ ] No em dashes, no buzzwords, does not read as a press release. The linter is a
      pre-filter, never the gate
