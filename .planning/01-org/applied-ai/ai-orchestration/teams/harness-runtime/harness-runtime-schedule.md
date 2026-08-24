---
type: schedule
division: applied-ai
department: ai-orchestration
team: harness-runtime
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth]
updated: 2026-08-24
links: ["[[harness-runtime-charter]]", "[[harness-runtime-loops]]", "[[harness-runtime-directive]]", "[[harness-runtime-agenda-full]]", "[[ai-orchestration-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[agent-fleet-charter]]", "[[decision-office-charter]]"]
---

# Harness & Runtime — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Daily | **DLQ sweep** — read every entry, classify (harness · agent · infra), assign | `nf_a.dlq_depth`, `dlq.entries_unassigned`, `dlq.oldest_entry_age` | proposed · **unblocked** |
| Daily | Retry-rate report **per agent**, against per-agent baselines | `nf_a.retries` | proposed · needs NF-A |
| Weekly | Diet check — did any commit widen `core/` while OD-03 is open? | `harness.core_lines_added_since_od03_opened` | proposed · **unblocked** |
| Monthly | **Harness coverage census** — modules doing agent work outside `BaseAgent`; abstractions in `core/` with one caller | `harness.agents_without_harness_guarantees`, `harness.single_caller_abstractions` | proposed · **unblocked** |
| On PR | Contract test suite — 80 pytest files under `services/agent-orchestrator/tests/` | pass/fail | **RUNNING** |
| One-shot, dated | **OD-03 bake-off** | a closed decision | proposed · needs cost + doneability instrumentation |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. Two notes on applying that literally here:

- **The diet check should stop firing when OD-03 closes** — and should then be
  deleted, not left as decoration. It is scoped to an open fork by construction.
- **The monthly census is expected to return 1 most months.** That is a *finding held
  steady*, not a null result. It is downgraded only when the count reaches 0 and the
  exception is closed.

## Skills owned

Skills live in `.claude/skills/`, **which does not exist yet** ([[skills-charter]]).
These are candidates with their [[README]] §3.3 rule-3 citations recorded now, while
the instances are still fresh.

| Candidate skill | Tier | Trigger | Real past instance |
|---|---|---|---|
| `harness-diet-check` | T2 department | A PR adds lines to `services/agent-orchestrator/core/` | OD-03 has been open since the decision log was written; `base_agent.py` is 1,053 lines, and every line added after the fork opened is write-off risk ([[harness-runtime-premortem]] #1) |
| `dlq-triage` | T3 operational | `queue.dead_letters` non-empty at the daily sweep | `technology.md:802-805` — retries and circuit breakers work exactly as designed, failures land in the DLQ, and nothing consumes it |
| `agent-contract-audit` | T3 operational | A new module lands in `services/agent-orchestrator/agents/` | `agents/recurring_order_agent.py:14` is a plain class with no retry, idempotency, DLQ or health check, owning scheduled purchasing — and it has passing tests, so no existing gate catches it. Separately, `core/orchestrator.py:198-206` records `EmailParsingAgent` shipping with a `process_message` signature that did not match `BaseAgent` |
| `single-caller-sweep` | T3 operational | Monthly census, or any PR adding an extension point to `core/` | The three-tier registry (`agent_registry.py:27-32`) is currently clean; this skill exists to keep it that way, and its citation is the accretion mechanism in [[harness-runtime-premortem]] #4 |

**Lifecycle.** [[skills-charter]] owns the `SKILL.md` contract and
[[skill-lifecycle-anti-sprawl-charter]] owns the 30-day staleness review — including
of these. `harness-diet-check` is explicitly expected to be deleted after OD-03
closes.

## Handoffs on a cadence

| To | When | What |
|---|---|---|
| [[agent-fleet-charter]] | Daily | DLQ entries classified *agent defect*; agents with sustained elevated retry |
| `[[sre-resilience]]` | Daily | DLQ entries classified *infrastructure* |
| [[ai-orchestration-schedule]] | Weekly | `nf_a.retries`, `nf_a.dlq_depth` for the department board |
| [[decision-office-charter]] | Monthly, and on the bake-off date | `od03.days_open`; the closed decision, or why it did not close |
