---
name: fleet-census
description: Use when anyone asks "how many agents do we have?", when a PR touches services/agent-orchestrator/agents/ or the registration map, or before quoting a fleet number in any doc — the honest answer has four different counts and this produces all of them with evidence.
---

# fleet-census

owner: agent-fleet (applied-ai) — card `fleet-census-agent`, [[agent-fleet-agent-stack]]

## Trigger

Weekly per the card; on demand whenever a fleet number is about to be written
down; on any PR touching `services/agent-orchestrator/agents/` or
`core/orchestrator.py`'s `_register_agent_classes`.

## How to run

```bash
python3 scripts/agents/run_card.py --agent fleet-census-agent
```

Add `--write-memory` only when the run should land facts in the unit's
`memory/` dir (they ride the PR like any other diff).

## Doneability

The four counts (on disk / subclassing BaseAgent / registered / can receive)
plus named orphans and dead subscribed topics, reproducible by rerun on the
same commit. Stub detection is a stated heuristic — the report says so; a
census that hides its method is not done.

## Real past instance

The 2026-08-24 generation session hand-derived the counts (26 on disk, ≈18
live, 3 orphans — [[agent-fleet-charter]] §Corrections); the 2026-08-28 first
automated run measured 24 / 23 / 23 / 23 with one orphan
(`recurring_order_agent`), catching four days of silent drift the charter
still carries. That drift is exactly what a repeated census exists to catch.
