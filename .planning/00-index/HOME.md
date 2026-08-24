---
type: moc
title: Home
updated: 2026-08-24
---

# Mudavym — Vault Home

Autonomous restaurant operations platform. One entity; many small softwares inside it.

## Start here

| Map | What it answers |
|---|---|
| **[[AGENDA]]** | **What is happening now** — blocked on you, in flight, next actions |
| **[[PLAN]]** | **What gates what** — the critical path |
| [[ORG-MAP]] | Who exists — divisions → departments → teams → advisory |
| [[SCENARIO-MAP]] | What happens in a restaurant — the 17 rituals |
| [[PAGES-MAP]] | The product surface — 50 pages, endpoints, signals, rebrand debt |
| [[LOOP-MAP]] | What feeds back into what, and how fast it closes |
| [[METRICS]] | Every metric the org names — and whether it has a number today |
| [[DECISION-INDEX]] | What is locked, how a decision moves, where the ADRs are |
| [[OPEN-DECISIONS]] | What is still undecided, and what unblocks it |
| [[GLOSSARY]] | What the coined terms mean — read this before the unit docs |
| [[README]] *(foundation)* | The 7-layer stack, skills, neural footprint |

## Reading order for a new session

1. `CLAUDE.md` — how we work here
2. `decisions/README.md` — what is locked
3. `foundation/ORG_STRUCTURE.md` — the org contract
4. `foundation/README.md` — the stack and the metric spine

## Honest state

```dataview
TABLE WITHOUT ID status AS "Charter status", length(rows) AS Units
FROM "01-org" OR "02-advisory"
WHERE type = "charter"
GROUP BY status
```

The org is **designed, not operating**. See [[LOOP-MAP]]: of 482 loops, only a handful
carry status `active` or `running`. Treat the corpus as a plan, not as capability.
