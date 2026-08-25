---
type: schedule
division: applied-ai
department: ai-orchestration
team: agent-fleet
status: partial
metrics: [nf_a.task_success_rate, fleet.live_agent_ratio]
updated: 2026-08-24
links: ["[[agent-fleet-charter]]", "[[agent-fleet-loops]]", "[[agent-fleet-directive]]", "[[agent-fleet-agenda-full]]", "[[ai-orchestration-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[harness-runtime-charter]]", "[[agent-evaluation-gates-charter]]", "[[reliability-sre-charter|reliability-charter]]"]
---

# Agent Fleet — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Per commit | **Topic-graph check** — every subscription has ≥1 publisher; every publish has ≥1 subscriber | `fleet.subscription_coverage` | proposed · **unblocked** |
| Per PR | Prompt-change verdict gate — no eval verdict, no merge | `prompt_changes_with_verdict_pct` | proposed · needs verdict definition |
| Daily | Consume DLQ entries classified *agent defect* from [[harness-runtime-charter]] | agent defect queue | proposed |
| Weekly | **Fleet doneability report — stubs listed separately** | `nf_a.task_success_rate` | proposed · needs NF-A |
| Weekly | Idle scan — enabled agents with zero messages processed in 7 days | `agent.messages_processed_7d` | proposed |
| Weekly | Guardian canary run — inject a known violation, confirm it is caught | `guardian.canary_catch_rate` | proposed · needs TECH-F6 |
| Monthly | **Registration audit** — on disk vs `BaseAgent` vs registered vs enabled vs subscribed | `fleet.live_agent_ratio`, `fleet.orphan_modules` | proposed · **unblocked** |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. Two exemptions, stated rather than assumed:

- **The topic-graph check** is expected to pass silently once the graph is clean. It
  is a *recurrence guard*, and deleting a recurrence guard for not firing is how the
  defect it guards against comes back. Exempt.
- **The guardian canary** is expected to be caught every time. A canary that is always
  caught is a canary doing its job. Exempt — and if it is ever *not* caught, that is
  the most important signal this team produces.

The **monthly registration audit is not exempt** and should genuinely go quiet once
`fleet.orphan_modules` reaches 0 and stays there. Its purpose is to force decisions,
not to exist.

## Skills owned

Skills live in `.claude/skills/`, **which does not exist yet** ([[skills-charter]]).
Candidates, with their [[README]] §3.3 rule-3 citations recorded now while the
instances are fresh — rather than written after the fact to satisfy a checklist.

| Candidate skill | Tier | Trigger | Real past instance |
|---|---|---|---|
| `agent-registration-audit` | T3 operational | A new module lands in `services/agent-orchestrator/agents/`, or monthly | `core/orchestrator.py:198-206` — `EmailIntelAgent` and `EmailParsingAgent` were *"fully implemented and absent from this registry, so nothing consumed inbound vendor email at all"*. Plus three modules today (`book_scraper_agent`, `dataset_creator_agent`, `recurring_order_agent`) referenced by nothing but their own tests |
| `topic-graph-check` | T3 operational | Any change to a subscription or a publish call | Same incident: `EmailIntelAgent` subscribed to `email.inbound.raw`, **zero publishers**. Registered, enabled, healthy, doing nothing |
| `stub-honesty-check` | T2 department | Any doc, deck, README or status page stating an agent count | Five registered agents with real names and real descriptions whose `process_message()` only logs. The registry reads as a capability list, and `core/orchestrator.py:214-217` already says so in prose: *"which is how 'registered' came to be mistaken for 'live'"* |
| `guardian-canary` | T1 domain | Weekly, per guardian agent | `drift_agent.py`, `state_invariant_enforcer.py`, `inequality_detector.py` all report by *raising findings*. Zero findings currently means either a clean system or a broken detector, and nothing distinguishes them |
| `prompt-change-review` | T2 department | A PR edits an agent prompt or few-shot set | Prompts are edited inline in Python with no attached verdict; `.github/workflows/ci.yml:226-230` shows the gate shape that already works for merge policies |

**Lifecycle.** [[skills-charter]] owns the `SKILL.md` contract;
[[skill-lifecycle-anti-sprawl-charter]] owns the 30-day staleness review. Note that
`topic-graph-check` and `guardian-canary` are recurrence guards whose success looks
like silence — they need the same exemption from the 30-day rule that the schedule
above gives their jobs, and that exemption should be recorded in the `SKILL.md`
itself rather than argued each time.

## Handoffs on a cadence

| To | When | What |
|---|---|---|
| [[harness-runtime-charter]] | Daily | Agents whose defects are harness-shaped, not behavior-shaped |
| [[agent-evaluation-gates-charter]] | Weekly | Task families shipping prompt changes with no eval coverage |
| `[[state-integrity-invariants-charter|sre-state-integrity]]` | Weekly | Guardian canary results; guardian code changes |
| [[ai-orchestration-schedule]] | Weekly | `fleet.live_agent_ratio` and the four counts for the department board |
| Product | On event | Any external artifact quoting an agent count without the live/stub split |
