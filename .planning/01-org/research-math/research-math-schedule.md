---
type: schedule
division: research-math
department: research-math
status: provisional
metrics: [nf_a.event_completeness, nf_a.verified_task_success_rate, nf_a.cost_per_completed_task, nf_a.harness_overhead_ms]
updated: 2026-08-24
links: ["[[research-math-charter]]", "[[research-math-loops]]", "[[research-math-directive]]", "[[research-math-agenda-board]]", "[[harness-model-routing-schedule]]", "[[evaluation-doneability-schedule]]", "[[neural-footprint-instrumentation-schedule]]", "[[decision-office-charter]]", "[[skills-charter]]", "[[0001-mudavym-single-entity]]"]
---

# Research & Math — Schedule & Skills

## The non-preemptible lane — read first

[[0001-mudavym-single-entity]]'s review trail grants this department **a long-horizon
schedule product deadlines cannot preempt**, in place of the separate research company
that was declined. That grant is operationalized here, or it is decoration.

**Rule.** The three items below may not be deferred, compressed, or re-staffed by any
in-department decision, by a sprint plan, or by a launch date. Preemption is a **founder
decision recorded in `OPEN-DECISIONS.md`** — proposable by anyone, grantable by one
person. A slip with a product reason attached and no record is the earliest signal in
[[research-math-premortem]] M1, and [[decision-office-charter]] owns catching it.

| Long-horizon item | Why it cannot be sliced | Owner |
|---|---|---|
| **The OD-03 bake-off on this repo's own workloads** | A truncated bake-off produces a pick from repute with a table attached — the thing `OD-03 (OPEN-DECISIONS.md:27)` explicitly forbids | [[harness-model-routing-charter]] |
| **Golden sets with real (free) negatives, 3 task types** | Sets rushed to a deadline are sets authored by imagination; that is the documented failure mode (`eval_guest_merge_policies.py:10`) | [[evaluation-doneability-charter]] |
| **NF-A brought to one joinable event** | Half-instrumented telemetry is worse than none: it looks measured and is not | [[neural-footprint-instrumentation-charter]] |

Two further protections from the same grant, recorded so they are auditable:

- **RM-2 and RM-1 staffing are never fungible within a close-time.** If the auditors are
  lent to the harness team, `nf_a.verified_task_success_rate` publishes as
  *"not measured this week — auditors reassigned"*, in those words, on
  [[research-math-agenda-board]].
- **No velocity metric may be added to this department's board.** Not features, not
  tickets, not PRs, not teams unblocked ([[research-math-charter]] §Metrics).

## Recurring work

| Cadence | Job | Emits | Owner |
|---|---|---|---|
| **Weekly** | **Skill health** — what fired, what went stale ([[README]] §6, §3.3 anti-sprawl) | NF-A | [[evaluation-doneability-charter]] |
| **Weekly** | Publish the four primary metrics, blanks included; publish verified **beside** self-reported (`base_agent.py:144`) | NF-A | Department |
| **Weekly** | `share_of_model_calls_through_wrapper` + count of callsites still on raw `fetch` (**7 today**) | NF-A | [[harness-model-routing-charter]] |
| **Weekly** | Private-telemetry-table scan — any *new* table holding token counts, cost, or a verdict outside the NF contract | — | [[neural-footprint-instrumentation-charter]] |
| **Weekly** | CI eval run with a **cost cap**, per `v3.0-TECH-DEBT.md:326-330`; the cap is a founder number and overrunning it escalates rather than switching the suite off | NF-A | [[evaluation-doneability-charter]] |
| **Fortnightly** | OD-11 schema-contract working session with [[data-charter]] until it closes; fork INTEL-F3 decided inside it | — | [[neural-footprint-instrumentation-charter]] |
| **Monthly** | Cost-per-completed-task review; routing changes only against a verdict, never against price alone | NF-A | [[harness-model-routing-charter]] |
| **Monthly** | **Applied AI seam audit** — duplicated golden sets, duplicated routing policy, unowned seams. Output is a merge proposal or "clean" | — | Department |
| **Monthly** | Department agenda sync — full vs board drifted? ([[README]] §6) | — | Department |
| **Quarterly** | Bake-off re-run once OD-03 is decided; and the NF-C entry-trigger check — is a funded study partner or an API-accessible biosignal device present? ([[0006-neural-footprint-architecture]]) | — | Department |
| **Quarterly** | Premortem review — [[research-math-premortem]] against what actually happened. Nothing revisited in 60 days is fiction | — | Department |

**Anti-sprawl, applied to this table.** A scheduled job that produces no action for **3
consecutive runs** is downgraded or deleted ([[README]] §6). Two candidates are already
visible: the private-telemetry-table scan should go quiet once the contract lands (that is
success, and it should then be folded into CI rather than run by hand), and the seam audit
should terminate in a decision rather than recur forever.

## Skills owned

Skills live in `.claude/skills/`. A skill that has not fired in 30 days is reviewed for
deletion ([[README]] §3.3).

**State today, honestly: this department owns a tier that governs almost nothing.** The
repo has exactly **one** project skill (`.agents/skills/railway-config/SKILL.md`,
[[README]] §3.1). Root `SKILLS.md` is a prose reasoning protocol, not a skill, and still
carries the stale "WineOps AI" brand (OD-14).

| Tier | Skill | State | Notes |
|---|---|---|---|
| **T4** | `skill-create` | **Not built — deliberately** | [[README]] §3.2 assigns T4 here. Building a creation skill before there is a registry is scaffolding around an empty room |
| **T4** | `skill-review` | **Not built — deliberately** | Its job is the §3.3 anti-sprawl audit, which is a *measurement* job and therefore RM-2's ([[evaluation-doneability-charter]]) |
| **T4** | `department-agenda-sync` | **Not built** | Would drive the monthly full-vs-board drift check. First real T4 candidate, because the drift it detects is already real at 99 units |
| **T2** | `doneability-criteria-draft` | **Proposed** | Step 2 of the skill protocol ([[README]] §3.3) is literally "name the doneability criteria" — the department that owns doneability should own that step |
| **T2** | `nf-event-audit` | **Proposed** | Scans for model callsites that emit no NF event. Cites a real past instance: the 7 NestJS callsites, found by grep, currently 0 of 7 |

**Entry trigger for treating T4 as real work:** the skill registry exceeds **~15 skills**,
or **two skills are found to overlap in production** (`intelligence.md:504`). Until then
T4 is a claim on future scope, not a backlog — and this department is the one that has to
resist filling it, since the anti-sprawl rule it enforces applies to itself first.
[[skills-charter]] (Applied AI) owns the registry mechanics if and when it exists; we own
whether a skill is *earning its place*.
