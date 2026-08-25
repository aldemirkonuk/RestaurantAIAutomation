---
type: schedule
division: corporate
department: people-agent-ops
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[people-agent-ops-charter]]", "[[people-agent-ops-loops]]", "[[people-agent-ops-agenda-board]]", "[[roster-lifecycle-schedule]]", "[[performance-doneability-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[skill-registry-authoring-charter]]", "[[decision-office-charter]]"]
---

# People & Agent Ops — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Per PR | **Agent registration gate** — a new file in `services/agent-orchestrator/agents/` must appear in `core/orchestrator.py`'s class map or in the declared-exclusion register (L-PAO-2) | Pass/fail; `roster.new_module_gate_pass_rate` |
| Per PR | **Spec-declaration check** — a registered agent with no `DEFAULT_AGENT_SPECS` entry fails, instead of silently taking `{}` at `core/agent_registry.py:337` | `roster.silent_default_spec_count` |
| Daily | **Roster census** — three-way diff: filesystem · orchestrator class map · `DEFAULT_AGENT_SPECS` (L-PAO-1) | `roster.unregistered_module_count`, `roster.truth_pct`, one defect row per diff |
| Daily | **Stub-flag audit** — every `IS_STUB = True` module still refused at boot (`core/orchestrator.py:245`), and every non-stub still implements `process_message()` | `roster.declared_stub_count`, stub-drift alerts |
| Weekly | **Doneability coverage publication** — the number and the blocker age, whether or not either moved (L-PAO-3) | `nf_a.doneability_verdict_coverage`, `people.blocked_days` |
| Weekly | **Dependency escalation sweep** — any Research & Math dependency older than two close-times goes to `OPEN-DECISIONS.md` automatically | `OPEN-DECISIONS.md` entries; CORP-F5 age |
| Monthly | **Cost-attribution readiness** — is spend attributable to a worker yet (L-PAO-4) | `nf_a.agent_attributed_spend_pct`; a binary, not an estimate |
| Monthly | **Headcount reconciliation** — 19 / 23 / 24 / 26 against every external artifact that quotes a number, `.planning/PROJECT.md:33,121` included | Corrections, or a recorded disagreement |
| Quarterly | **Fleet review** — maturity levels re-evidenced, retirements proposed (L-PAO-5) | Level changes; retirement decisions; criteria findings to [[evaluation-doneability-charter]] |
| Quarterly | **Artifact staleness sweep** — anything untouched 60+ days is finished or fiction ([[README]] §3.3, §6) | Archive or revision |
| Trigger-gated | **Human onboarding** — fires on the second person on the payroll (`corporate.md:418`) | Request into [[legal-charter]]; a human-review rubric that does not exist yet |

Two things are deliberately **not** on this table. There is no monthly "agent performance
review" — L-PAO-5 is gated and quarterly, and running it on liveness data is the failure
premortem M3 describes. And there is no human review cycle, because there is nobody to
review; the trigger-gated row is the honest version of that.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion — the anti-sprawl rule ([[README]] §3.3) applies here exactly as it does to
agendas, and this department has a specific reason to respect it: a skill *is* a worker
procedure, so skill sprawl and roster sprawl are the same disease.

**The department's skill surface is proposed, not built.** The repo has exactly one
project skill today (`.agents/skills/railway-config/SKILL.md`, [[README]] §3.1), so
nothing below exists. Each candidate is tied to a job in the table above rather than
invented for coverage, and each satisfies [[README]] §3.3: a named trigger, a doneability
criterion, and a real past instance.

| Proposed skill | Fires on | Real past instance it would have caught | Owning team |
|---|---|---|---|
| `agent-roster-census` | Daily census, and per PR | The two Phase 24 agents that were fully implemented and registered nowhere (`core/orchestrator.py:200-205`) | [[roster-lifecycle-charter]] |
| `agent-onboarding-gate` | New module in `agents/` | `book_scraper_agent`, `dataset_creator_agent` — `BaseAgent` subclasses with zero call sites today | [[roster-lifecycle-charter]] |
| `stub-flag-audit` | Daily | `IS_STUB` exists precisely because an event-consuming no-op *"looks healthy from every dashboard"* (`core/orchestrator.py:242-243`) | [[roster-lifecycle-charter]] |
| `agent-maturity-classify` | Quarterly fleet review | `.planning/PROJECT.md:117` asserts "all Level 0-1" over 24 agents with no per-agent evidence | [[roster-lifecycle-charter]] |
| `doneability-coverage-report` | Weekly | Corrected 2026-08-25: one verdict basis exists (`reconciliation_v1`, invoices — ADR 0017), coverage still ~0%, and it has never been published as a number | [[performance-doneability-charter]] |
| `agent-cost-attribution-check` | Monthly | `SpendLogger.log()` has had no `agent` parameter since it was written (`spend_logger.py:41-49`) | [[performance-doneability-charter]] |
| `headcount-reconcile` | Monthly | Four live headcounts — 19, 23, 24, 26 — and no artifact reconciles them | [[roster-lifecycle-charter]] |

**Nothing in this table exists yet.** It is listed so that a skill gets created against a
scheduled job with a close-time, rather than a skill getting created and a job invented to
justify it. Registry governance sits with [[skills-charter]] and
[[skill-lifecycle-anti-sprawl-charter]] (Applied AI) — this department authors skills and
is subject to the registry's rules, it does not run the registry.

**A boundary worth naming.** `skill-lifecycle-anti-sprawl` retires unused *skills*; this
department retires unused *agents*. The two jobs rhyme and are not the same, and the seam
between them — a skill that only one retired agent ever fired — is a question for
[[decision-office-charter]] the first time it comes up, not an argument to have later.
