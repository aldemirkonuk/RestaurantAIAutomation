---
type: schedule
division: research-math
department: research-math
team: evaluation-doneability
status: provisional
metrics: [nf_a.verified_task_success_rate, nf_a.verdict_coverage, identity.false_merge_count]
updated: 2026-08-24
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-directive]]", "[[evaluation-doneability-agenda-board]]", "[[research-math-schedule]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[skills-charter]]", "[[security-charter]]"]
---

# Evaluation & Doneability (RM-2) — Schedule & Skills

## Non-preemptible

One item from the department's protected lane ([[research-math-schedule]]) is this team's:
**golden sets with real (free) negatives, for three task types.** Sets rushed to a
deadline are sets authored by imagination, which is the documented failure mode in this
repo's own words (`scripts/eval_guest_merge_policies.py:10`). Preemption is a founder
decision recorded in `OPEN-DECISIONS.md`.

**And one staffing protection:** RM-2 and [[harness-model-routing-charter]] staffing are
never fungible within a close-time. If the auditors are lent to the harness team,
`nf_a.verified_task_success_rate` publishes as *"not measured this week — auditors
reassigned"*, in those words. Making the revocation visible is what stops it being free.

## Recurring work

| Cadence | Job | Emits |
|---|---|---|
| **Per PR** | Identity false-merge gate — pass condition exactly **0**, never summed with false splits (`scripts/eval_merge_policies.py:5-13`) | — |
| **Per PR** | Guest false-merge gate — reports 0 pairs today because guest capture has not started; **that is the gate working** (`eval_guest_merge_policies.py:19-24`) | — |
| **Per PR** | Cheap eval subset (tier 1) once the suite exists | NF-A |
| **Weekly** | **Publish the gap** — `nf_a.verified_task_success_rate` beside `base_agent.py:144`. Verified never publishes alone | NF-A |
| **Weekly** | **Full CI eval run with a cost cap** (§44.11, `v3.0-TECH-DEBT.md:326-330`; slot reserved at `.github/workflows/e2e-prod.yml:9`). Overrun escalates, never self-disables | NF-A |
| **Weekly** | Catch log — every regression blocked, with the cost of what it prevented. This is what a renewal conversation needs | — |
| **Weekly** | **Skill health** — registered / unfired-30d / overlapping ([[README]] §6, §3.3). **1 skill today**; stays cheap until ~15 | NF-A |
| **Weekly** | Pass-condition diff watch: any edit whose commit message names a date, a launch, or a release → escalate on the **first** | — |
| **Monthly** | Provenance review of every set: `free-negatives` vs `imagination-only`; coverage recomputed as **share of model spend under verdict** | — |
| **Monthly** | Duplication audit vs [[agent-evaluation-gates-charter|aio-evaluation-gates]] — a threshold existing twice with two values is the tell. We file the merge proposal ourselves | — |
| **Quarterly** | Re-adjudicate a sample of past verdicts. An auditor that never re-checks itself is asserting, not measuring | — |
| **Quarterly** | Premortem review against what actually happened | — |

**Anti-sprawl.** A job producing no action for **3 consecutive runs** is downgraded or
deleted ([[README]] §6). The skill-health report is the obvious candidate — it will report
"1 skill" for months. It stays because it costs almost nothing and because the habit is
the point; if it is still reporting 1 skill in six months, **delete it and re-add it at
the activation trigger.**

## Skills owned

Skills live in `.claude/skills/`. Unfired for 30 days → reviewed for deletion. Every skill
below names a **trigger**, **doneability criteria**, and **a real past instance**
([[README]] §3.3) — no speculative skills, a rule this team enforces on everyone and
therefore first on itself.

| Tier | Skill | State | Trigger · Doneability · Real past instance |
|---|---|---|---|
| **T4** | `skill-review` | **Proposed — this team's T4 assignment** | *Trigger:* weekly, and on any new `SKILL.md`. *Done:* every skill has a trigger, doneability criteria, a cited past instance, an owning department; unfired-30d list produced. *Past instance:* the repo has 1 project skill and a root `SKILLS.md` that is not a skill and still says "WineOps AI" (OD-14) — the registry is already inconsistent at n=1 |
| **T2** | `doneability-criteria-draft` | **Proposed** | *Trigger:* a new task type reaches production. *Done:* a written criterion, a named negative source, a pass condition. *Past instance:* `base_agent.py:144` defines success as "the handler did not raise" and has shipped that way |
| **T2** | `eval-set-provenance-audit` | **Proposed** | *Trigger:* any new or changed eval manifest. *Done:* marks each set `free-negatives` or `imagination-only`; blocks gate authority for the latter. *Past instance:* three merge designs died to free negatives; one had committed 212 false merges |
| **T3** | `eval-suite-cost-report` | **Proposed, ships with the suite** | *Trigger:* weekly run. *Done:* spend vs cap, plus catch log. *Past instance:* §44.11 mandates cost caps and names none — the gap that switches suites off |
| **T4** | `skill-create` | **Not built — deliberately** | Activates at ~15 skills. Building a creation skill at n=1 is sprawl authored by the anti-sprawl team |

**Honest note.** Only two artifacts in this table have a running ancestor
(`eval_merge_policies.py`, `eval_guest_merge_policies.py`) and both are identity gates. The
rest is new. Build `eval-set-provenance-audit` first — it is the field on which two of
five premortem mechanisms turn, and it costs one line in a manifest.
