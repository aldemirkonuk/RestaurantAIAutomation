---
type: agenda-board
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: provisional
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-charter]]", "[[agent-fleet-agenda-full]]", "[[agent-fleet-premortem]]", "[[agent-fleet-loops]]", "[[ai-orchestration-agenda-board]]"]
---

# Agent Fleet — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/applied-ai/ai-orchestration/teams/agent-fleet"
SORT type ASC
```

## Sibling teams — for seam checks

```dataview
TABLE WITHOUT ID file.link AS Team, status
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter" AND team != this.team
SORT file.name ASC
```

## The fleet, counted four ways

| Count | Value | Source |
|---|---|---|
| Modules on disk | **26** | `agents/*.py` |
| Subclass `BaseAgent` | **25** | `recurring_order_agent.py:14` is a plain class |
| Registered | **23** | `core/orchestrator.py:174-211` |
| **Can receive a message** | **≈18** | 23 − 5 stubs gated off |

- `fleet.live_agent_ratio` = **≈18 / 26**
- `fleet.orphan_modules` = **3** — `book_scraper_agent`, `dataset_creator_agent`, `recurring_order_agent`
- `fleet.subscription_coverage` = **unmeasured**
- `nf_a.task_success_rate` = **not emitted**, for any agent

## The five stubs — registered, gated off, `process_message()` only logs

- [ ] `auto_pilot_agent.py`
- [ ] `compliance_agent.py`
- [ ] `ghost_inventory_agent.py` · guardian, co-owned with `[[sre-state-integrity]]`
- [ ] `negotiation_playbook_agent.py`
- [ ] `shrinkage_detective_agent.py` · guardian, co-owned

> A stub that logs and returns posts a **perfect** success rate. Averaging stubs into
> the fleet figure inflates it — it does not blur it.

## Unblocked now

- [ ] Publish the four counts; make `fleet.live_agent_ratio` primary
- [ ] Add `stub: true` to `DEFAULT_AGENT_SPECS` (`agent_registry.py:51`)
- [ ] Topic-graph CI check — every subscription has a publisher, **and** vice versa

## Blocked

- [ ] Orphan decision × 3 *(founder input on `recurring_order_agent`)*
- [ ] Guardian canaries *(OD-24 ownership)*
- [ ] `nf_a.task_success_rate` per agent *(NF-A emission)*
- [ ] Prompt versioning + verdict gate *(verdict definition — [[agent-evaluation-gates-charter]])*

## Watch signals

- [ ] An agent count published **outside** `services/agent-orchestrator/` without the live/stub split
- [ ] An enabled agent with **zero messages processed** over a week — idle ≠ broken, and we cannot yet tell them apart
- [ ] A prompt edit merged with no eval verdict attached
- [ ] A guardian agent's finding rate at zero and **staying** there
- [ ] `fleet.orphan_modules` rising above 3

## Open forks

- [ ] **OD-24** — guardian co-ownership: Fleet owns code, SRE owns findings. Workable?
- [ ] The three orphans: adopt · delete · document the exemption
- [ ] The five stubs: keep with a `stub: true` flag, or delete the ones with no near-term plan
