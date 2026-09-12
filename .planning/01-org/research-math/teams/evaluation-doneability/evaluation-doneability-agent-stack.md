---
type: agent-stack
division: research-math
department: research-math
team: evaluation-doneability
status: designed
updated: 2026-08-27
metrics: [nf_a.verified_task_success_rate, identity.false_merge_count, nf_a.verdict_coverage]
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-schedule]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-directive]]", "[[0034-agent-stack-artifact]]", "[[research-math-agent-stack]]", "[[harness-model-routing-agent-stack]]", "[[agent-evaluation-gates-charter]]", "[[skills-charter]]", "[[0017-doneability-verdicts-are-sidecar-claims]]"]
---

# Evaluation & Doneability (RM-2) — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This agent may fail a sibling team without asking, and may not tune anything it grades.
> **TECH-F3 is open** — [[agent-evaluation-gates-charter]] runs the gates, we define what
> passing means; if the line fails, the remedy accepted in advance is **merge, not
> duplicate** (`technology.md:406`).

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `doneability-auditor` | Hold the gates that already run, publish verified beside self-reported, and mark every eval set `free-negatives` or `imagination-only` — without touching what it grades | NEW |

## 2. Agent cards

```yaml
agent: doneability-auditor
unit: evaluation-doneability
triggers:
  - topic: pr.opened            # publisher: .github/workflows/ci.yml (identity gate :526, grading guard :179); guest gate: schema-parity.yml:207
  - schedule: "weekly — publish the gap; full CI eval run under a cost cap; skill health"   # [[evaluation-doneability-schedule]]
  - schedule: "monthly — set provenance review; duplication audit vs aio-evaluation-gates"
  - schedule: "quarterly — re-adjudicate a sample of past verdicts"
consumes:
  - neural_footprint_event plus its verdict sidecar claims — publisher: model-client.service.ts:413 and nf-verdict.service.ts (ADR 0017)
  - self-reported success_rate — publisher: services/agent-orchestrator/core/base_agent.py:144
  - datasets/merge_eval/ (entries, adjudicated, manifest) — publisher: scripts/build_merge_eval_set.py
  - the task-type grading manifest — publisher: scripts/check_task_types_are_graded.py
emits:
  - 'a verdict per graded task type — consumer: "[[research-math-agenda-board]]"; it publishes whether or not RM-1 agrees (independence clause 3)'
  - 'pass conditions committed before results exist — consumer: "[[harness-model-routing-charter]]"''s bake-off (clause 1)'
  - a set-provenance label (free-negatives | imagination-only) per eval set — consumer: the gate that would otherwise inherit its authority
  - 'a merge proposal if a golden set is maintained twice — consumer: "[[agent-evaluation-gates-charter]]" (TECH-F3, open)'
  - 'nf_a events (task_type: eval_gate_run) — consumer: "[[neural-footprint-instrumentation-charter]]"''s contract'
routing_class: judgment          # writing a doneability criterion is judgment; enforcing one stays a script
quality_bar: "identity.false_merge_count = 0, never summed with false splits (scripts/eval_merge_policies.py:5-13); every task type graded or on the shrink-only exemption list (scripts/check_task_types_are_graded.py)"
autonomy:
  read: autonomous
  propose: autonomous            # verdicts, pass conditions and provenance labels land as PRs
  mutate_stock_money_outbound: confirm    # constant
memory: evaluation-doneability
escalates_to: "[[research-math-charter]]"
```

**The card's own hard rules.** [[harness-model-routing-charter]] may not modify a golden
set, a threshold or a pass condition this agent owns; disputes resolve at the founder or
[[decision-office-charter]], **never at the author** (independence clause 2). A close_time
breach escalates to the department; a *verdict dispute* does not — that would be the
department grading its own homework. And the auditor never tunes what it grades.

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `eval-set-provenance-audit` | T2 | Any new or changed eval manifest | Each set marked `free-negatives` or `imagination-only`; the latter loses gate authority | Three merge designs died to free negatives, one having committed **212 false merges**, tested against 732,874 free known-distinct pairs (`scripts/eval_guest_merge_policies.py:1-30`) | NEW |
| `doneability-criteria-draft` | T2 | A new task type reaches production | A written criterion, a named negative source, a pass condition | `base_agent.py:144` ships "success = the handler did not raise"; and the P3.0 pass wrote 7 gateway task-type criteria by hand on 2026-08-27 (`.planning/STATE.md:91,98-105`) | NEW |
| `skill-review` | T4 | Weekly, and on any new `SKILL.md` | Every skill names trigger, doneability, cited past instance, owning unit; the unfired-30d list is produced | The registry is inconsistent at n=0: `.claude/skills/` holds only a README, and the one `SKILL.md` on disk is gitignored vendor tooling (`.gitignore:100`) — the charter's "1 skill today" is already stale | NEW |
| `eval-suite-cost-report` | T3 | Weekly suite run, once the suite exists | Spend against the cap, plus the catch log — what was blocked and what it would have cost | §44.11 mandates weekly CI evals with cost caps and names no number (`v3.0-TECH-DEBT.md:326-330`); the workflow slot is reserved and empty (`.github/workflows/e2e-prod.yml:7`) | NEW |

`skill-create` is **not a row**: [[evaluation-doneability-schedule]] holds it unbuilt until
~15 skills, and a creation skill at n=0 would be sprawl authored by the anti-sprawl team.

Consumed, owned elsewhere: the envelope and registry ([[skills-charter]]); gate operation
in CI and production ([[agent-evaluation-gates-charter]] — TECH-F3 open); exact-equality
checks of deterministic arithmetic ([[analytics-bi-charter]] AB-3).

## 4. Memory

- **Procedural** — the §3 skills; candidates reach [[skill-harvesting-charter]]'s queue and
  face the §3.3 gate this team owns.
- **Episodic** — nf_a `task_type: eval_gate_run`, joined to the verdict sidecar
  ([[0017-doneability-verdicts-are-sidecar-claims]]). Needs `context.task_type` and
  `context.verdict_basis` as jsonb keys: without the basis, coverage is a count of rows
  rather than a measure of what was actually graded, which is the failure the exemption
  list exists to prevent.
- **Semantic** — `memory/` beside this file, indexed by `evaluation-doneability-MEMORY.md`.
  Its first facts are already known and checkable: the 212-false-merge design and the label
  that killed it; the size of the verified-minus-self-reported gap the first week it is
  computed; each set's provenance verdict. `source`, `confidence`, `last_verified` in
  frontmatter; every write a PR.
- **Working** — this card, the MEMORY index, charter §Mandate and the four independence
  clauses, plus the one manifest under audit. The 946KB `datasets/merge_eval/` corpus is
  retrieval-only.

**Consolidation** — monthly, mirrored in [[evaluation-doneability-schedule]]: read the
gate-run slice; **failures first** — every red verdict becomes a fact naming the mechanism
("the negatives were authored", not "the score dropped"); re-check a sample of past verdicts
quarterly, because an auditor that never re-checks itself is asserting; expire facts
unverified for 90 days. One PR; "no delta" stated when true.

## 5. Async contract

Cross-unit interaction is loops ([[evaluation-doneability-loops]]), NF-A events, vault PRs
and skill candidates only. Gap rows:

| Gap | Why it is a gap |
|---|---|
| **TECH-F3 open — who runs the gates** | [[agent-evaluation-gates-charter]] is chartered to run and enforce; we define. The card does not pick. The tell is one threshold existing twice with two values, and the agreed remedy is a merge proposal filed by us |
| The weekly AI eval suite has no workflow | The slot is reserved with an explicit "do not implement here" (`e2e-prod.yml:7`), so `eval-suite-cost-report` has nothing to report against until Phase 42 lands |
| Verdict disputes have no event | RM-1 disputes in writing, in `questions.md`; nothing notifies the founder or [[decision-office-charter]], so the dispute ages at reading speed |
| `nf_a.verdict_coverage` needs a join | Verdicts are sidecar claims by design (ADR 0017); coverage is therefore a join, and a missing `context.verdict_basis` key makes it uncomputable rather than merely slow |

## 6. Evidence today

- **EXISTS — two real gates, both wired into CI.** `scripts/eval_merge_policies.py` runs at
  `.github/workflows/ci.yml:526`; `scripts/eval_guest_merge_policies.py` runs at
  `.github/workflows/schema-parity.yml:207`. These are the team's founding methodology, not
  merely prior art.
- **EXISTS, and newer than the charter — a grading guard.**
  `scripts/check_task_types_are_graded.py` runs at `.github/workflows/ci.yml:179` and fails
  on a *redundant* exemption as well as a missing verdict. Per `.planning/STATE.md:91,98-105`
  it closed P3.0 on 2026-08-27: 7/7 gateway task types graded, 26 of 38 above `call_level_v0`.
- **PARTIAL — the headline metric.** `nf_a.verified_task_success_rate` is computable for the
  first time and has **never been published beside `base_agent.py:144`**. The gap — this
  team's actual product — is still unknown.
- **NEW — the auditor and all four skills**, the weekly cost-capped suite, and every
  doneability criterion outside the merge gates and the P3.0 manifest. All four past
  instances cited above are hand-work from the 2026-08-24→27 sessions.
