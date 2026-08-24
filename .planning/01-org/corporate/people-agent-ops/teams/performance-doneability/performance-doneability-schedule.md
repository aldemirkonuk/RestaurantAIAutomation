---
type: schedule
division: corporate
department: people-agent-ops
team: performance-doneability
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[performance-doneability-charter]]", "[[performance-doneability-loops]]", "[[performance-doneability-agenda-board]]", "[[people-agent-ops-schedule]]", "[[roster-lifecycle-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[evaluation-doneability-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[decision-office-charter]]"]
---

# Performance & Doneability — Schedule & Skills

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| Weekly | **Coverage publication** — `nf_a.doneability_verdict_coverage` published whether or not it moved, with the named blocker and its age (L-PD-1) | Coverage %, `people.blocked_days` |
| Weekly | **Blocker ageing** — every Research & Math dependency ages by one close-time; two without movement auto-escalates | `OPEN-DECISIONS.md` entries; CORP-F5 age |
| Weekly | **Unqualified-`success_rate` sweep** — any People & Agent Ops artifact using `success_rate` without "liveness, not correctness" | Escalation on the **first** instance |
| Monthly | **Cost-attribution readiness** — can spend name a worker yet; what share is attributed (L-PD-2) | `nf_a.agent_attributed_spend_pct`; a binary, never an estimate |
| Monthly | **Criteria specification** — write and hand over the spec for one live task type (L-PD-3) | `doneability.criteria_spec_coverage`; specs to [[evaluation-doneability-charter]] |
| Monthly | **Emission floor audit** — how many of the 26 modules call `log_decision()` (`core/base_agent.py:743`); how many emit nothing because unregistered (L-PD-5) | `nf_a.emission_coverage`; gaps to [[neural-footprint-instrumentation-charter]] |
| Quarterly | **Fleet performance review** — **gated**; may not run on liveness data (L-PD-4) | Verdicts and costs per agent, **or** a written "cannot review; here is what is missing" |
| Quarterly | **Artifact staleness sweep** — anything untouched 60+ days is finished or fiction ([[README]] §3.3) | Archive or revision |

**Deliberately absent: a weekly agent scorecard.** It is the single most requestable
artifact this team could produce and it would be built on `core/base_agent.py:144`'s
`success_rate`. That is premortem M1 in dashboard form, so it is not on the schedule and
its absence is recorded here rather than left to be noticed.

**Deliberately present while blocked:** three of the eight jobs above move numbers that do
not depend on CORP-F5 — criteria specification, emission floor, and the sweep. "Blocked"
must never mean "idle" ([[performance-doneability-directive]] rule 4).

## Skills owned

Skills live in `.claude/skills/`. A skill unfired for 30 days is reviewed for deletion
([[README]] §3.3). The repo has exactly one project skill today
(`.agents/skills/railway-config/SKILL.md`, [[README]] §3.1) — **nothing below exists.**

[[README]] §3.3 requires every skill to name its **doneability criteria** before it is
committed. This team is the one that owns applying that concept, so its own skills are the
first place the rule has to hold — a skill of ours without a criterion would be a
self-refutation.

| Proposed skill | Trigger | Doneability criterion | Real past instance |
|---|---|---|---|
| `doneability-coverage-report` | Weekly | Emits coverage **and** a blocker age; a report with no age fails | 0% has never been published as a number; the gap is asserted in prose only |
| `agent-cost-attribution-check` | Monthly, and on any change to `spend_logger.py` | Reports a binary plus a share; **any inferred figure fails the skill** | `SpendLogger.log()` has had no `agent` parameter since it was written (`spend_logger.py:41-49`) |
| `nf-a-emission-audit` | Monthly | Counts `log_decision()` call sites across all 26 modules and names those emitting nothing | Never counted. The number is available today |
| `doneability-criteria-draft` | A new task type reaches production | Spec names unit of work, deciding observable, abstention, **and confidently-wrong** | Invoice understanding runs in production with no written definition of done |
| `liveness-vs-success-lint` | Per PR touching `.planning/01-org/corporate/people-agent-ops` | Zero unqualified uses of `success_rate` in department artifacts | `core/base_agent.py:602` sets `success=True` on "did not raise"; `get_health():989` gates on it |
| `verdict-emission-check` | When a verdict schema is proposed | Verdict is a field on the NF-A spine, not a review-only artifact | None yet — listed because premortem M5 says the wrong choice is made once and is permanent |

**Nothing in this table exists yet.** Two entries deserve a note under §3.3's "no
speculative skills" rule: `doneability-criteria-draft` and `verdict-emission-check` have
no past instance because the practice they encode has never happened here. They are
listed as **candidates gated on their first real trigger** — the first production task
type, and the first verdict schema proposal — rather than built now.

Registry governance belongs to [[skills-charter]] and
[[skill-lifecycle-anti-sprawl-charter]] (Applied AI); this team authors and is governed.

**One seam worth naming now.** [[README]] §3.3 requires every *skill* to declare its
doneability criteria — which makes [[skills-charter]] a consumer of this team's core
product, and makes a skill's criteria and an agent's criteria two applications of one
methodology owned by [[evaluation-doneability-charter]]. If those two drift apart, "done"
means two things in one company. Raising it once, here, is cheaper than discovering it in
an argument.
