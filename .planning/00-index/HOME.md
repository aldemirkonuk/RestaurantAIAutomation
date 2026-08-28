---
type: moc
title: Home
updated: 2026-08-28
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
| [[CARD-MAP]] | **The agent layer** — every unit's declared agents, their class, and their gaps ([[0034-agent-stack-artifact]]) |
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

The org is **designed, barely operating — and the gap is now measured, not guessed**
(re-counted 2026-08-28):

- **[[LOOP-MAP]]: 485 loops, 5 of them live** (3 `active` + 2 `running`); 438 still `proposed`.
- **[[CARD-MAP]]: 102 declared agents across 100 units, 8 of which actually execute**
  (`scripts/agents/run_card.py`); 58 carry no quality bar at all.
- **Agendas: 48 of 200 are `status: active`** — the 24 department-level units were written
  for real in wave 3 (ADR 0039); the 152 team-level agendas still carry the
  `PROVISIONAL — no work done yet` banner, and that banner is honest.
- **Skills: 4 committed**, all §3.3-compliant; firing telemetry does not exist yet.

Treat the corpus as a plan, not as capability — but the plan now names its own
denominators, so "what is real" is a query rather than an opinion.
