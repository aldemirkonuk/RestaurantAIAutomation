---
type: agenda-board
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: provisional
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-agenda-full]]", "[[agent-evaluation-gates-premortem]]", "[[agent-evaluation-gates-loops]]", "[[ai-orchestration-agenda-board]]", "[[research-math-charter|research-and-math-charter]]", "[[decision-office-charter]]"]
---

# Agent Evaluation & Gates — Board

> **PROVISIONAL — no work done yet.**

> ⚠️ **This team may not exist.** The seam with Research & Math is open. If the
> methodology/operations line fails, the answer is **merge, never duplicate**
> (`technology.md:406`). The backlog below survives either outcome.

## This team's artifacts

```dataview
TABLE type, status, updated
FROM "01-org/applied-ai/ai-orchestration/teams/agent-evaluation-gates"
SORT type ASC
```

## Sibling teams — for seam checks

```dataview
TABLE WITHOUT ID file.link AS Team, status
FROM "01-org/applied-ai/ai-orchestration/teams"
WHERE type = "charter" AND team != this.team
SORT file.name ASC
```

## Coverage by task family — zeros are named, not omitted

| Task family | Verdict coverage | Gate |
|---|---|---|
| Identity / merge policy | **gated per-commit** | `ci.yml:226-230` → `eval_merge_policies.py` |
| Guest identity merge | **gated** | `schema-parity.yml:149` |
| OCR / document extraction | benchmarked once, **not gated** | `datasets/ocr_benchmark_results.json` |
| Model substitution (haiku vs sonnet) | run once, **not gated** | `scripts/benchmark_haiku_vs_sonnet.py` |
| Vision | benchmarked once, **not gated** | `scripts/claude_vision_benchmark.py` |
| **Vendor reply quality** | **0** | — |
| **Negotiation stance** | **0** | — |
| **Recommendation usefulness** | **0** | — |
| **Invoice field accuracy in production** | **0** | — |
| **Menu parse accuracy in production** | **0** | — |

> **Every gate running today scores an extraction-shaped task. Not one scores a
> judgment-shaped task.** That is the founding problem, not a backlog item.

## Numbers

| Metric | Today |
|---|---|
| `nf_a.doneability_verdict_coverage` | near zero outside the merge-policy gate |
| `eval.families_with_zero_coverage` | **5**, listed above |
| `eval.gold_set_staleness` | unmeasured |
| `eval.rubric_inter_rater_agreement` | **no rubric exists** |
| Blocking gates | **2** — both extraction-shaped |
| Advisory / warn-only gates | **0** — and this must stay 0 |

## Unblocked now

- [ ] Publish the coverage table above, zeros named
- [ ] Capture approve / edit / discard on vendor-reply drafts **as labels** — the source exists and is being discarded daily
- [ ] Required field on every new gate: *how does this set grow from production traffic?*

## Blocked

- [ ] Vendor-reply rubric, n≈30, two raters *(methodology — [[research-math-charter|research-and-math-charter]])*
- [ ] Weekly AI eval workflow, **D-25** *(NF-A emission)* — reserved at `e2e-prod.yml:7`, unbuilt
- [ ] Confidence calibration curves *(NF-A paired outcome data)*

## Watch signals

- [ ] The **first** gate marked `continue-on-error` / non-blocking / warn-only — especially with the word *temporarily*
- [ ] This team **defining** a rubric rather than enforcing one. Once = miss. **Twice = the seam has failed**
- [ ] A gold set that has not grown in a quarter while new task types shipped
- [ ] A confidence threshold used as an **autonomy** boundary with no calibration curve
- [ ] Coverage reported as one aggregate number anywhere

## Open forks

- [ ] **The seam** — methodology (R&M) vs operations (here), or one team in Intelligence
- [x] ✅ **ID collision resolved** — `technology.md:845` said OD-21, already spent at `OPEN-DECISIONS.md:138`; renamespaced to **TECH-F3** ([[FORK-REGISTRY]])
- [ ] Which judgment task matters most commercially — vendor reply, negotiation, or recommendation?
- [ ] Are `governance.py:20` confidence tiers already gating what a human sees?
