---
type: agenda-board
division: applied-ai
department: ai-orchestration
status: provisional
metrics: [nf_a.task_success_rate, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count, routing.routed_client_share, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-agenda-full]]", "[[ai-orchestration-premortem]]", "[[ai-orchestration-loops]]", "[[harness-runtime-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[agent-evaluation-gates-charter]]", "[[action-safety-the-human-gate-charter]]"]
---

# AI Orchestration — Board

> **PROVISIONAL — no work done yet.**

## Unit status — live query, not a hand-written list

```dataview
TABLE status, type, updated
FROM "01-org/applied-ai/ai-orchestration"
SORT team ASC, type ASC
```

## Teams and their one question

```dataview
TABLE WITHOUT ID
  file.link AS Team,
  status AS Evidence,
  updated AS Updated
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter"
SORT file.name ASC
```

## Loops owned, by close-time

```dataview
TABLE close_time, status
FROM "01-org/applied-ai/ai-orchestration"
WHERE type = "loops"
SORT close_time ASC
```

## Metric set — no roll-up, by design

| Metric | Owner | Value today |
|---|---|---|
| `fleet.live_agent_ratio` | [[agent-fleet-charter]] | **≈18 / 26** |
| `routing.routed_client_share` | [[model-routing-inference-economics-charter]] | **0 / 7** gateway call sites metered |
| `nf_a.doneability_verdict_coverage` | [[agent-evaluation-gates-charter]] | near zero outside the merge-policy gate |
| `nf_a.retries` · `nf_a.dlq_depth` | [[harness-runtime-charter]] | **not emitted** |
| `nf_a.cost_per_task` | [[model-routing-inference-economics-charter]] | **not emitted** |
| `nf_a.task_success_rate` (stubs reported separately) | [[agent-fleet-charter]] | **not emitted** |
| `safety.unconfirmed_mutation_count` | [[action-safety-the-human-gate-charter]] | target hard zero · **unmeasured** |

- "Not emitted" is not a bad value. It is **no value** — [[README]] §1, L4.
- Four of seven are uncomputable until Step 0 of [[ai-orchestration-agenda-full]] lands.

## Unblocked now — no dependencies

- [ ] Publish `fleet.live_agent_ratio`; triage 3 orphan modules — [[agent-fleet-charter]]
- [ ] One routed model client; `api_spend` writes from the gateway — [[model-routing-inference-economics-charter]]
- [ ] Instrument time-to-confirm **before** volume arrives — [[action-safety-the-human-gate-charter]]

## Blocked

- [ ] One NF-A event end to end *(blocked: NF-A schema shape, [[README]] §4.4)*
- [ ] OD-03 harness bake-off *(blocked: Step 0; no preferred answer — do not acquire one)*
- [ ] Weekly AI eval workflow, D-25 *(blocked: Step 0 + the evaluation seam)*

## Open forks on this board

- [ ] **OD-03** — harness: hermes-agent · deepseek-harness · in-house `base_agent.py`. **Open. No pick.**
- [ ] **The evaluation seam** — methodology (R&M) vs operations (here); **merge, never duplicate**
- [x] ✅ **ID collision resolved** — the seam is **TECH-F3** ([[FORK-REGISTRY]]); `technology.md:845` originally called it OD-21, already spent at `OPEN-DECISIONS.md:136`
- [ ] **OD-04** — external model roster; downstream of OD-03
- [ ] **TECH-F6** — guardian-agent co-ownership: Fleet owns code, SRE owns findings
- [ ] **TECH-F1 / TECH-F5** — team-layer granularity and 7-vs-3 artifacts

## Watch signals — from [[ai-orchestration-premortem]]

- [ ] `core/base_agent.py` gains a **new capability** while OD-03 is open
- [ ] Any agent count quoted outside `services/agent-orchestrator/` without the live/stub split
- [ ] Median time-to-confirm collapsing, or confirmation rate approaching 100%
- [ ] A model ID changed in a commit citing cost and not citing an eval run
- [ ] `doneability_verdict_coverage` reported as one number instead of per task family
