---
type: agenda-board
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: provisional
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-charter]]", "[[harness-runtime-agenda-full]]", "[[harness-runtime-premortem]]", "[[harness-runtime-loops]]", "[[ai-orchestration-agenda-board]]"]
---

# Harness & Runtime — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/applied-ai/ai-orchestration/teams/harness-runtime"
SORT type ASC
```

## Sibling teams — for seam checks

```dataview
TABLE WITHOUT ID file.link AS Team, status
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter" AND team != this.team
SORT file.name ASC
```

## Numbers

| Metric | Today |
|---|---|
| `harness.agents_without_harness_guarantees` | **1** — `agents/recurring_order_agent.py:14` |
| `nf_a.retries` per agent-hour | **not emitted** |
| `nf_a.dlq_depth` | **not emitted**; no consumer exists |
| `core/` size | 6,375 lines · 11 modules · 80 pytest files |
| `base_agent.py` | 1,053 lines |
| `harness.core_lines_added_since_od03_opened` | baseline set at founding |

## Unblocked now

- [ ] Publish `harness.agents_without_harness_guarantees`
- [ ] Daily DLQ sweep: read, classify, **assign**
- [ ] List every `core/` abstraction with exactly one caller

## Blocked

- [ ] One NF-A event end to end *(NF-A schema shape — [[README]] §4.4)*
- [ ] Per-agent retry baselines *(needs NF-A)*
- [ ] **OD-03 bake-off** *(needs cost + retry instrumentation first)*

## The diet — active while OD-03 is open

- ✅ Allowed: bug fixes · instrumentation · interface **narrowing**
- ⛔ Deferred: new `BaseAgent` capability · new registry tier · new lifecycle hook
- Rationale: narrowing pays under all three OD-03 outcomes; widening bets on one

## Watch signals

- [ ] First commit adding **new capability** to `core/` while OD-03 is open
- [ ] DLQ depth **monotonic** — never draining means no consumer
- [ ] Any `core/` abstraction with exactly one caller
- [ ] A single agent's retry rate elevated while the fleet average looks fine
- [ ] `harness.agents_without_harness_guarantees` rising above 1

## Open forks

- [ ] **OD-03** — hermes-agent · deepseek-harness · in-house `base_agent.py`. **No pick.**
- [ ] `recurring_order_agent`: adopt · delete · document the exemption
- [ ] Does `database.py` (2,046 lines) belong in the harness contract?
- [ ] Who consumes the DLQ — this team, [[agent-fleet-charter]], or `[[sre-resilience]]`?
</content>
