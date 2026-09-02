---
type: schedule
division: applied-ai
department: ai-orchestration
status: exists
metrics: [nf_a.retries, nf_a.dlq_depth, nf_a.cost_per_task, nf_a.doneability_verdict_coverage, safety.unconfirmed_mutation_count]
updated: 2026-08-24
links: ["[[ai-orchestration-charter]]", "[[ai-orchestration-loops]]", "[[ai-orchestration-directive]]", "[[ai-orchestration-agenda-full]]", "[[skills-charter]]", "[[skill-registry-authoring-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[research-math-charter|research-and-math-charter]]", "[[reliability-sre-charter|reliability-charter]]", "[[decision-office-charter]]"]
---

# AI Orchestration — Schedule & Skills

## Recurring work

| Cadence | Job | Owner team | Emits | State |
|---|---|---|---|---|
| Per commit | Merge-policy eval gate | [[agent-evaluation-gates-charter]] | pass/fail verdict | **RUNNING** — `.github/workflows/ci.yml:226-230` |
| Daily | DLQ + retry sweep: read `queue.dead_letters`, classify, assign | [[harness-runtime-charter]] | `nf_a.dlq_depth` | proposed |
| Daily | Unconfirmed-mutation scan — any agent write to stock/money/outbound with no `executed_by` | [[action-safety-the-human-gate-charter]] | `safety.unconfirmed_mutation_count` | proposed |
| Weekly | Fleet doneability report, **stubs listed separately** | [[agent-fleet-charter]] | `nf_a.task_success_rate`, `fleet.live_agent_ratio` | proposed |
| Weekly | Inference spend review — cost by task type, routed-client share | [[model-routing-inference-economics-charter]] | `nf_a.cost_per_task` | proposed |
| Weekly | AI eval workflow (**D-25**) — the one `.github/workflows/e2e-prod.yml:7` explicitly reserves | [[agent-evaluation-gates-charter]] | `nf_a.doneability_verdict_coverage` per task family | **NEW — not built** |
| Monthly | Human-gate behaviour review: median time-to-confirm, rejection rate | [[action-safety-the-human-gate-charter]] | behavioural trend | proposed |
| Monthly | Registration audit — modules on disk vs registered vs enabled vs subscribed | [[agent-fleet-charter]] | `fleet.live_agent_ratio` | proposed |
| **One-shot, dated** | **OD-03 harness bake-off** | [[harness-runtime-charter]] | a closed decision | proposed |

**Anti-sprawl, per [[README]] §6:** a scheduled job that produces no action for **3
consecutive runs** is downgraded or deleted. Applied literally here, the daily
unconfirmed-mutation scan should produce no action almost always — so its rule is
inverted and stated explicitly: **it is exempt, because zero is its success
condition.** A safety scan that gets deleted for finding nothing is the premortem
writing itself. Every other job on this list is subject to the rule as written.

### The one-shot job, because a date is the whole point

`OPEN-DECISIONS.md:27` gives OD-03 a method (*"a scoped bake-off on this repo's actual
workloads. No pick from repute"*) and no date.
[[ai-orchestration-premortem]] #1 is that fork staying open by ordinary gravity while
`core/base_agent.py` accumulates work that a later decision throws away. Putting the
bake-off on a schedule with a date is the counter-pressure; missing that date is an
escalation trigger in [[ai-orchestration-directive]] §5.

**Its inputs are Steps 0–2 of [[ai-orchestration-agenda-full]]** — harness overhead
cannot be compared without cost instrumentation, task outcomes cannot be compared
without doneability verdicts. So the date is set *after* Step 0 lands, and setting it
is itself a scheduled decision rather than a hope.

## Skills owned

Skills live in **`.claude/skills/`**. **The directory does not exist yet**
([[skills-charter]] §Evidence) — so every entry below is a *candidate*, not a
registry line. Listing them as owned would be exactly the speculation
[[README]] §3.3 rule 3 forbids.

Per that rule, a skill may not be committed without citing **a real past instance
where it would have helped**. Those instances are recorded here now, while they are
still fresh, precisely so the citation is not written after the fact to satisfy a
checklist ([[skill-registry-authoring-charter]] premortem).

| Candidate skill | Tier | Trigger | Real past instance it would have caught |
|---|---|---|---|
| `agent-registration-audit` | T3 operational | A new module lands in `services/agent-orchestrator/agents/` | Three modules — `book_scraper_agent.py`, `dataset_creator_agent.py`, `recurring_order_agent.py` — are referenced by nothing but their own tests. And `core/orchestrator.py:198-206` records that `email_intel_agent` and `email_parsing_agent` were *"fully implemented and absent from this registry, so nothing consumed inbound vendor email at all"* — three defects, and the missing registration hid the other two |
| `model-substitution-check` | T3 operational | A commit changes a model ID | `scripts/benchmark_haiku_vs_sonnet.py` exists to prevent silent substitution and has been run essentially once. Seven gateway files pin model IDs independently (`consultants.service.ts:156`, `inbound-responder.service.ts:21`, `photo-count.service.ts:60`, `scan-parser.service.ts:261`, `document-extractor.service.ts:75`, `ux-optimizer.service.ts:250`, `vendor-page-extractor.service.ts:71`) — and `inbound-responder.service.ts:18` already carries a comment about a model retired in Feb 2026 |
| `mutation-gate-review` | T2 department | A PR touches a code path that writes stock, money, or an outbound channel | The guarantee is currently upheld by **four independent conventions, not one mechanism** (`technology.md:441`); `drift_agent.py:8-12` implements it in one place, `one-tap-actions.service.ts:230` in another |
| `dlq-triage` | T3 operational | `queue.dead_letters` is non-empty at the daily sweep | `technology.md:802` — *"the DLQ is a well-engineered place where problems go to be forgotten."* No consumer exists |
| `harness-diet-check` | T2 department | A PR adds lines to `services/agent-orchestrator/core/` | OD-03 is open; new `BaseAgent` capability is a bet on one of three outcomes ([[ai-orchestration-directive]] §The harness fork) |

**Ownership seam.** This department owns these skills' **content**;
[[skills-charter]] owns the `SKILL.md` contract, the registry, and the 30-day
staleness review that deletes them ([[skill-lifecycle-anti-sprawl-charter]]). A skill
here that has not fired in 30 days is reviewed for deletion like any other — including
`harness-diet-check`, which by construction should stop firing the moment OD-03
closes, and should then be deleted rather than left as decoration.

## What this department owes other schedules

| To | When | What |
|---|---|---|
| [[research-math-charter|research-and-math-charter]] | Continuous | NF-A events — we are the largest producer; they own the methodology |
| [[skills-charter]] | Continuous | `skill_id` on the NF-A event, the cheapest firing signal available |
| `[[inference-cost-charter|fin-inference-cost]]` | Weekly | `nf_a.cost_per_task` by task type |
| [[reliability-sre-charter|reliability-charter]] | Daily | DLQ depth and guardian-agent findings (TECH-F6 splits code from findings) |
| [[decision-office-charter]] | On the bake-off date | OD-03, closed — or an explicit statement of why it did not close |
