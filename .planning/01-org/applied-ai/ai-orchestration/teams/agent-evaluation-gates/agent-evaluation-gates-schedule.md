---
type: schedule
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: partial
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-loops]]", "[[agent-evaluation-gates-directive]]", "[[agent-evaluation-gates-agenda-full]]", "[[ai-orchestration-schedule]]", "[[skills-charter]]", "[[skill-lifecycle-anti-sprawl-charter]]", "[[research-and-math-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]"]
---

# Agent Evaluation & Gates — Schedule & Skills

## Recurring work

| Cadence | Job | Emits | State |
|---|---|---|---|
| Per commit | **Merge-policy eval gate** — rebuild the labelled set, run the eval, exit non-zero on any false merge | `identity.false_merge_count` | **RUNNING** — `ci.yml:226-230` |
| Per commit | Guest merge-policy gate | guest false-merge count | **RUNNING** — `schema-parity.yml:149` |
| Per PR | Model-substitution verdict — key two of the two-key gate | pass/fail | proposed |
| Per PR | Prompt-change verdict for [[agent-fleet-charter]] | pass/fail | proposed |
| **Weekly** | **AI eval workflow — D-25** | `nf_a.doneability_verdict_coverage` per family | **NEW** — reserved at `e2e-prod.yml:7`, unbuilt |
| Weekly | Coverage report **per task family**, zeros named | `eval.families_with_zero_coverage` | proposed |
| Monthly | Gold-set freshness sweep — staleness, and sets with no growth mechanism | `eval.gold_set_staleness` | proposed · **unblocked** |
| Monthly | Judgment-rubric rating session — n≈30, two raters | `eval.rubric_inter_rater_agreement` | proposed |
| Quarterly | Confidence calibration against paired outcome data | `confidence.calibration_error` | proposed · needs NF-A |

**Anti-sprawl ([[README]] §6):** a job producing no action for 3 consecutive runs is
downgraded or deleted. **The CI gates are exempt**, and the reason is worth stating
because it will be argued: a blocking gate that passes silently is *succeeding*.
Deleting `eval_merge_policies.py` because it has not caught a false merge in three
months would remove the thing preventing false merges — the single error the repo
describes as *"silent, global and unrecoverable"*
(`scripts/eval_merge_policies.py:4-5`).

The **coverage report and the gold-set sweep are not exempt**. Both exist to force
decisions, and if they stop producing decisions they should go.

## Skills owned

Skills live in `.claude/skills/`, **which does not exist yet** ([[skills-charter]]).
Candidates, with their [[README]] §3.3 rule-3 citations recorded now while the
instances are fresh.

| Candidate skill | Tier | Trigger | Real past instance |
|---|---|---|---|
| `eval-gate-author` | T2 department | Someone proposes a new eval gate | `scripts/eval_merge_policies.py` is the only gate in the repo that declares its own pass criterion, its own asymmetry rule, and its own growth mechanism (`:9-16`). Every other eval artifact — `benchmark_haiku_vs_sonnet.py`, `claude_vision_benchmark.py`, `datasets/scripts/eval_model.py` — is a script somebody ran once. The skill encodes the difference |
| `gold-set-freshness` | T3 operational | Monthly, or when a new task type ships | `services/active_learning_service.py:1-17` describes 200 gold-standard documents with no declared refresh path; `datasets/ocr_benchmark_results.json` is a single captured run |
| `judgment-rubric-session` | T2 department | Monthly, per judgment task family | Vendor-reply drafts are never auto-sent, so a human approves/edits/discards every one — and none of those decisions is captured as a label. The rubric this skill runs is the only path to a verdict for a task with no right answer |
| `coverage-report` | T2 department | Weekly | Coverage does not exist as a number today; when it does, the failure mode is publishing it as one aggregate. The skill's job is largely to refuse to aggregate |
| `confidence-calibration` | T1 domain | Quarterly | `governance.py:20` defines five tiers from `CANONICAL` to `UNRESOLVED` and `:227` computes an overall confidence — with no calibration curve behind either |

**Lifecycle.** [[skill-lifecycle-anti-sprawl-charter]] owns the 30-day staleness
review. `eval-gate-author` is expected to fire rarely by design — gates are not
authored weekly — and that should be recorded in its `SKILL.md` as a stated low-frequency
expectation rather than argued at each review.

## Handoffs on a cadence

| To | When | What |
|---|---|---|
| [[model-routing-inference-economics-charter]] | Per PR | The pass verdict — key two of the two-key gate |
| [[agent-fleet-charter]] | Weekly | Regressed families; families with no coverage to gate a prompt change |
| [[research-and-math-charter]] | Weekly | **Every place operations needed a definition that did not exist.** This handoff is the seam's early-warning system — two of these on the same topic means the line has failed |
| [[ai-orchestration-schedule]] | Weekly | Coverage per family for the department board |
