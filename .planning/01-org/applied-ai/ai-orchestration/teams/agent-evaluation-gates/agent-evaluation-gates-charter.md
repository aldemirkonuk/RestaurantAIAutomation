---
type: charter
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: partial
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-premortem]]", "[[agent-evaluation-gates-agenda-full]]", "[[agent-evaluation-gates-agenda-board]]", "[[agent-evaluation-gates-directive]]", "[[agent-evaluation-gates-loops]]", "[[agent-evaluation-gates-schedule]]", "[[ai-orchestration-charter]]", "[[research-and-math-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[decision-office-charter]]", "[[technology]]", "[[README]]"]
---

# Agent Evaluation & Gates — Charter

Team of [[ai-orchestration-charter]] · Division: **Applied AI** · Alias in the team
corpus: `[[aio-evaluation-gates]]` (`technology.md:392`).

> ⚠️ **This team's existence is an open question, and this charter does not pretend
> otherwise.** See §The seam. If the methodology/operations line fails, the correct
> outcome is to **merge this team into Research & Math — not to duplicate it.**

## Mandate

**Run and enforce** doneability: gold sets, regression benchmarks, CI eval gates,
confidence scoring, and the shadow-vs-live comparison discipline.

**Distinct from siblings because an agent team that grades its own agents is exactly
the arrangement [[ORG_STRUCTURE]] §3 rejects for Red Team.** Distinct from
[[model-routing-inference-economics-charter]] because routing picks the cheapest model
that *passes*; **this team defines what passing means in operation**
(`technology.md:397-400`).

## The seam — stated because it is the sharpest in the whole division

**Research & Math** (Intelligence division) owns the *methodology and the NF-A metric
definition* ([[README]] §2.2). This team owns *running the gates in CI and
production*. **Methodology vs. operations.**

`technology.md:402-406` states the fallback plainly, and this charter carries it
forward without softening:

> *"If that line proves unworkable, the fix is to merge this team into Research &
> Math — not to duplicate it."*

And `technology.md:845`: **"Duplication here is worse than either answer."**

**The concrete test.** The line has failed when the same eval is defined twice, or when
a task family has two verdicts that disagree, or — most likely — when this team finds
itself *defining* a rubric because Research & Math has not yet, twice running. One
occurrence is a coordination miss. Two is the line failing, and the escalation is
*"merge"*, never *"build it in both places"*
([[agent-evaluation-gates-directive]] §Escalation).

> ⚠️ **ID collision, flagged not resolved.** `technology.md:845` numbers this fork
> **OD-21**. `.planning/decisions/OPEN-DECISIONS.md:25` already uses **OD-21** for the
> Obsidian structural workflow, which is locked ([[OBSIDIAN_VAULT]]). The evaluation
> seam needs a free ID before it can enter the decision log at all — a fork that
> cannot be cited cannot be closed. → [[decision-office-charter]].

## Boundaries

Owns outright: the **operation** of evaluation — the CI gates, the gold-set
maintenance, the shadow-vs-live runs, the confidence scoring in production, and the
weekly AI eval workflow that `.github/workflows/e2e-prod.yml:7` explicitly reserves
and nobody has built.

## Explicit non-goals

| Not ours | Whose | The line |
|---|---|---|
| **NF-A metric definitions; what a doneability verdict *means*; eval methodology** | [[research-and-math-charter]] *(Intelligence)* | **The seam above.** They define; we enforce |
| Agent behavior and prompts | [[agent-fleet-charter]] | We tell them a task family regressed; they fix the agent |
| Which model to pick given a pass | [[model-routing-inference-economics-charter]] | We say what passes; they pick the cheapest thing that does |
| **Grading data rows** | `[[dat-substrate-quality]]` | Task outcome vs. data row (`technology.md:862`) |
| Product correctness (a wrong stock number, a false merge) | [[engineering-charter]] | Task outcome ≠ product correctness |
| Attacking *decisions* | [[red-team-charter]] | They premortem decisions; we measure task outcomes |

## Metrics it moves

- **`nf_a.doneability_verdict_coverage`** — share of agent tasks that emit a
  machine-checkable verdict rather than a log line. **Today: near zero outside the
  merge-policy gate** (`technology.md:415-417`).
- **Reported per task family, never as one number.** This is not presentation
  preference. An aggregate is exactly what hides the families with zero coverage, and
  those are the commercially load-bearing ones
  ([[agent-evaluation-gates-premortem]] #1).
- `eval.families_with_zero_coverage` — the complement, named on the board rather than
  omitted from it.
- `eval.gold_set_staleness` — days since each gold set last grew.
- `eval.rubric_inter_rater_agreement` — for judgment tasks, where there is no gold set
  and there never will be.

## Evidence today

**EXISTS, scattered across `scripts/` with no owner** (`technology.md:408`).

**Running in CI right now — the template everything else should copy:**
- `.github/workflows/ci.yml:226-230` — *"Rebuild the labelled eval set from the
  committed corpus"* (`scripts/build_merge_eval_set.py`), then run
  `scripts/eval_merge_policies.py`.
- `scripts/eval_merge_policies.py:9-16` declares the gate: *"the false-merge count of
  the PROPOSED policy alone is the pass/fail signal… Exits 1 iff the proposed policy
  has any false merge."* And the discipline that makes it durable: *"Every new menu
  added to `datasets/menu_corpus/extracted` strengthens this gate automatically;
  nobody hand-labels anything."*
- `.github/workflows/schema-parity.yml:149` — `scripts/eval_guest_merge_policies.py`.

That is a **complete loop**: a labelled set rebuilt from a corpus, a hard verdict, a
per-commit close-time, and no hand-labelling. It is the only one, and it is the shape
every other gate should be built in.

**Exists but unwired:**
- `scripts/benchmark_haiku_vs_sonnet.py`, `scripts/claude_vision_benchmark.py`,
  `datasets/scripts/eval_model.py`
- `datasets/ocr_benchmark_results.json`, `datasets/OCR_CONFIDENCE_REPORT.md`
- `services/active_learning_service.py:1-17` — *"200 gold-standard documents for
  regression testing"*
- `services/quality_scorer.py`, `services/field_confidence.py`,
  `services/ontology_validation_service.py`

**NEW — the weekly AI eval workflow.** `.github/workflows/e2e-prod.yml:7`:
*"Phase 42 will add a separate weekly AI eval workflow — do not implement here
(D-25)."* Reserved, named, not built.

### The shape of what exists — the finding, not a list

Every gate that runs today scores an **extraction-shaped** task: does this string
match that string, did these two records refer to the same wine, did OCR read the
number correctly. Not one scores a **judgment-shaped** task: was this a good reply to
a vendor, was this negotiation stance reasonable, was this recommendation worth making.

That is not an accident of sequencing — extraction is scoreable and judgment is not,
so evaluation went where the gold sets could exist. And the judgment tasks are the ones
`inbound-responder.service.ts` and `negotiation_playbook_agent` are for, which is to
say the commercially load-bearing half of the product is unmeasured.

That imbalance is this team's founding problem and its premortem.

## Status

`partial` — one real gate, running per-commit, on one task family.
</content>
