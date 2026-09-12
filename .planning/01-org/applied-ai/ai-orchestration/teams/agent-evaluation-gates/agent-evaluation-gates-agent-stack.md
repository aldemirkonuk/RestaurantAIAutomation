---
type: agent-stack
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: designed
updated: 2026-08-27
metrics: [nf_a.doneability_verdict_coverage, eval.families_with_zero_coverage, eval.gold_set_staleness]
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-schedule]]", "[[agent-evaluation-gates-loops]]", "[[0034-agent-stack-artifact]]", "[[ai-orchestration-agent-stack]]", "[[research-math-charter|research-and-math-charter]]"]
---

# Agent Evaluation & Gates — Agent Stack

> **DESIGNED — nothing here is built unless its Evidence line says EXISTS.**
> This team's existence is itself an open question (TECH-F3: if the
> methodology/operations line fails, merge into Research & Math). Its card is
> therefore written to survive the merge: everything here is *operations* — running
> gates, watching staleness, reporting coverage. If a card row ever *defines* a
> rubric, the seam has failed in this document too.

## 1. Roster

| Agent | Job in one sentence | Evidence |
|---|---|---|
| `gate-runner` | Run the eval gates on their cadence, keep verdict coverage reported per task family, and flag every gold set that stopped growing | PARTIAL — one gate already runs per-commit in CI |

## 2. Agent cards

```yaml
agent: gate-runner
unit: agent-evaluation-gates
triggers:
  - topic: ci.pipeline_run                                  # publisher: EXISTS — .github/workflows/ci.yml:226-230 runs the merge-policy gate per commit
  - schedule: "weekly AI eval sweep"                        # reserved by e2e-prod.yml:7 ("Phase 42… D-25") and not built
consumes:
  - the labelled sets rebuilt from committed corpora (build_merge_eval_set.py pattern)
  - nf_a verdict sidecar claims (ADR 0017 — nf_verdict, one row per event+basis)
  - rubrics and verdict definitions FROM Research & Math (never authored here — TECH-F3)
emits:
  - gate verdicts as ADR 0017 sidecar claims, never edits to events
  - "per-family coverage table (zero-coverage families named, not averaged out) → [[ai-orchestration-agent-stack|aio-orchestrator]]"
  - nf_a events (task_type: eval_gate_run)
routing_class: extraction         # today. Judgment-task grading is the known frontier — see §5 gap rows
quality_bar: "the gate's own discipline (eval_merge_policies.py:9-16): a hard exit code, a labelled set rebuilt from a corpus, no hand-labelling; coverage reported per family, never as one number"
autonomy:
  read: autonomous
  propose: autonomous              # a failing gate blocks CI — that is the gate acting as designed, not a mutation
  mutate_stock_money_outbound: confirm   # constant; grading never touches product data
memory: agent-evaluation-gates
escalates_to: "[[ai-orchestration-charter]] — and a rubric this team wrote twice because R&M had not goes straight to the TECH-F3 escalation: merge, never duplicate"
```

## 3. Skills

| Skill (`.claude/skills/…`) | Tier | Trigger | Doneability | Past instance | Status |
|---|---|---|---|---|---|
| `eval-gate-authoring` | T2 | A task family gains a gold set, or an existing gate needs a new corpus wired in | A gate in the merge-policy shape: corpus-rebuilt labelled set, hard exit code, per-commit or scheduled close-time, no hand-labelling | `scripts/eval_merge_policies.py` + `ci.yml:226-230` — the one complete loop the charter says everything else should copy | NEW as a skill; the pattern EXISTS |
| `verdict-coverage-report` | T2 | Weekly, and on request from the department rollup | Per-family table: covered / partial / zero, with `eval.families_with_zero_coverage` as the headline, not the footnote | The 2026-08-24 finding that every running gate scores extraction and none scores judgment — "the commercially load-bearing half of the product is unmeasured" (charter §The shape) | NEW |

Consumed, owned elsewhere: rubric and metric *definitions*
([[research-math-charter|research-and-math-charter]]); the NF-A schema (ADR
0006/0008); gold-set corpora content (the owning departments).

## 4. Memory

- **Procedural** — the §3 skills; candidates via [[skill-harvesting-charter]]'s queue.
- **Episodic** — nf_a `task_type: eval_gate_run` plus the verdict sidecar table
  itself (ADR 0017), which is this team's richest episodic record: every verdict,
  its basis, its date.
- **Semantic** — `memory/` beside this file, index
  `agent-evaluation-gates-MEMORY.md`. First facts: which families have zero
  coverage and since when; the extraction-vs-judgment imbalance (source: charter,
  2026-08-24). Failure facts are the point here — a family whose gate regressed
  gets a fact naming the mechanism. Provenance per ADR 0034; every write a PR.
- **Working** — this card, the MEMORY index, charter §The seam (so the TECH-F3
  boundary is loaded on every run, deliberately).

**Consolidation** — monthly: read the verdict sidecar slice; distill coverage
movement and gate regressions into facts; expire at 90 days unverified; propose
skill candidates. One PR; "no delta" stated when true.

## 5. Async contract

Gate verdicts are sidecar claims; coverage tables are board rows; rubric requests
to R&M are agenda-full questions (vault PR). Gap rows:

| Gap | Why it is a gap |
|---|---|
| The weekly AI eval sweep is reserved, not built | `e2e-prod.yml:7` names it (D-25) and explicitly defers it; until built, the per-commit merge gate is the only automated trigger |
| Judgment-shaped tasks have no grading basis | No gold set can exist for "was this a good vendor reply"; `eval.rubric_inter_rater_agreement` is defined and unmeasurable until R&M supplies a rubric — this card must wait, not improvise (TECH-F3) |
| Rubric requests have no event | An agenda-full question is the async path; R&M's schedule must poll it, and a request unanswered twice running *is* the seam failing (charter §The concrete test) |

## 6. Evidence today

- **EXISTS — one complete gate loop.** `eval_merge_policies.py` per-commit in
  `ci.yml:226-230`; `eval_guest_merge_policies.py` in `schema-parity.yml:149`.
- **EXISTS, unwired** — the benchmark scripts and quality scorers the charter lists
  (`benchmark_haiku_vs_sonnet.py`, `claude_vision_benchmark.py`,
  `quality_scorer.py`, `active_learning_service.py:1-17`).
- **NEW — the standing agent, both skills as skills, the weekly sweep, every
  judgment-task basis.** Verdict coverage near zero outside the merge gate.
