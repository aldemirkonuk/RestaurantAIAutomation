---
type: schedule
division: corporate
department: people-agent-ops
team: roster-lifecycle
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[roster-lifecycle-charter]]", "[[roster-lifecycle-loops]]", "[[roster-lifecycle-agenda-board]]", "[[people-agent-ops-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[ai-orchestration-charter]]", "[[legal-charter]]", "[[decision-office-charter]]"]
---

# Roster & Lifecycle — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Registration gate** — a new file in `services/agent-orchestrator/agents/` must appear in `core/orchestrator.py`'s class map or the declared-exclusion register (L-RL-2) | Pass/fail; `roster.new_module_gate_pass_rate` |
| Per PR | **Spec-declaration gate** — a registered agent absent from `DEFAULT_AGENT_SPECS` fails rather than silently taking `{}` (`core/agent_registry.py:337`) | Pass/fail; `roster.silent_default_spec_count` |
| Daily | **Three-way census** — filesystem (26) · orchestrator class map (23) · `DEFAULT_AGENT_SPECS` (19) — published as a 26-row table with a verdict per predicate (L-RL-1) | `roster.truth_pct`, `roster.unregistered_module_count`, one row per module |
| Daily | **Stub-flag audit** — every `IS_STUB = True` still refused at boot (`core/orchestrator.py:245`); every non-stub still implements `process_message()` | `roster.declared_stub_count`; stub-drift alerts |
| Weekly | **Silent-default audit** — registry statuses with an empty `description` as the cheap proxy for an empty `{}` spec (L-RL-3) | `roster.empty_description_count` |
| Weekly | **Defect ageing** — census defects open longer than one close-time, and who they are blocked on | Escalations to [[ai-orchestration-charter]] or `OPEN-DECISIONS.md` |
| Monthly | **Headcount reconciliation** — 19 / 23 / 24 / 26 swept against every artifact quoting an agent count, `.planning/PROJECT.md:33,121` included (L-RL-4) | `roster.headcount_claim_variance`; corrections |
| Quarterly | **Fleet lifecycle review** — maturity levels re-evidenced against their predicates; retirements proposed; unowned modules surfaced (L-RL-5) | `roster.maturity_level_evidenced_pct`, `roster.retirement_count` |
| Quarterly | **Artifact staleness sweep** — anything untouched 60+ days is finished or fiction ([[README]] §3.3) | Archive or revision |
| **Trigger-gated** | **Human onboarding** — fires on the second person on the payroll (`corporate.md:418`). Dormant, and deliberately unwritten until then | Request into [[legal-charter]]; a human-review rubric that does not exist |

**Two deliberate absences.** There is no monthly "agent review" — reviewing workers is
[[performance-doneability-charter]]'s, and L-RL-5 is quarterly and about the *record*.
And nothing describes a human process, because there is no human to apply it to; the
trigger-gated row is the honest version of that, per [[roster-lifecycle-directive]] rule 8.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion ([[README]] §3.3). The repo has exactly **one** project skill today
(`.agents/skills/railway-config/SKILL.md`, [[README]] §3.1), so **nothing below exists**.

Each candidate satisfies [[README]] §3.3's four requirements — a named trigger, a
doneability criterion, a real past instance, and an owning unit — because a skill invented
for coverage is the same disease as an agent registered for coverage.

| Proposed skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `agent-roster-census` | Daily, and on any PR touching `services/agent-orchestrator/agents/` | Emits a 26-row table with 4 verdicts per row; a bare percentage is a failure | The two Phase 24 agents implemented and registered nowhere — `core/orchestrator.py:200-205` |
| `agent-onboarding-gate` | A new module appears in `agents/` | Module ends in exactly one declared state: registered, or excluded with a reason | `book_scraper_agent:17`, `dataset_creator_agent:26` — `BaseAgent` subclasses with zero call sites |
| `stub-flag-audit` | Daily | Every `IS_STUB` module refused at boot; every non-stub implements `process_message()` | `IS_STUB` exists because an enabled no-op *"looks healthy from every dashboard"* — `core/orchestrator.py:242-243` |
| `spec-declaration-check` | Per PR, and weekly | Zero registered agents resolve their spec from `{}` | 4 agents today via `core/agent_registry.py:337` |
| `agent-maturity-classify` | Quarterly fleet review | Every level reproduced by a check; any level needing prose fails the skill | `.planning/PROJECT.md:117` asserts "all Level 0-1" over 24 agents with no per-agent evidence |
| `headcount-reconcile` | Monthly, and before any external artifact quoting an agent count ships | One number, or an explicit recorded disagreement | Four live counts — 19, 23, 24, 26 — reconciled nowhere |
| `agent-retirement-record` | A retirement is proposed | A written reason survives the deletion; escalation filed | None yet — `roster.retirement_count` is 0, which premortem M5 says is itself the risk |

**Nothing in this table exists yet.** It is listed so a skill is created against a
scheduled job with a close-time rather than the reverse. Registry governance belongs to
[[skills-charter]] / [[skill-lifecycle-anti-sprawl-charter]] (Applied AI); this team
authors and is governed, it does not govern.

**A note on `agent-retirement-record`.** It is the one skill here with **no** past
instance, which by §3.3's own rule ("no speculative skills") means it should not be built
yet. It is listed as a *candidate* precisely so that the first retirement creates it,
rather than the first retirement happening without a record.
