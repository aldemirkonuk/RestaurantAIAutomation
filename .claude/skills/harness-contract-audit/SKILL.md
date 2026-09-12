---
name: harness-contract-audit
description: Use when a new agents/*.py module lands, when work is proposed on services/agent-orchestrator/core/, or when checking the OD-03 diet — finds modules doing agent work outside the BaseAgent contract and keeps the core-lines sunk-cost meter current.
---

# harness-contract-audit

owner: harness-runtime (applied-ai) — card `harness-sentinel`, [[harness-runtime-agent-stack]]

## Trigger

Weekly per the card; on any PR adding a module under
`services/agent-orchestrator/agents/` or touching `core/`.

## How to run

```bash
python3 scripts/agents/run_card.py --agent harness-sentinel
```

## Doneability

Every module outside the `BaseAgent` contract named with its file; the `core/`
line total recorded as the OD-03 sunk-cost baseline. The audit only measures —
per the OD-03 diet it must never patch `core/`, and a sentinel that edits what
it watches has failed regardless of its numbers.

## Real past instance

The 2026-08-24 session found `recurring_order_agent.py` is a plain class — no
retry, idempotency, DLQ, health, or NF-A — while owning scheduled purchasing
([[harness-runtime-charter]] §Evidence). The 2026-08-28 automated run confirms
it is still the single module outside the contract, and set the core baseline
at 6,556 lines / 89 pytest files.
