---
type: agenda-board
division: research-math
department: research-math
team: evaluation-doneability
status: provisional
metrics: []
updated: 2026-08-24
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-agenda-full]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-schedule]]", "[[evaluation-doneability-premortem]]", "[[research-math-agenda-board]]"]
---

# Evaluation & Doneability (RM-2) — Board

> **PROVISIONAL — no work done yet.**

## This team's artifacts

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  type AS Type,
  status AS Status,
  updated AS Updated
FROM "01-org/intelligence/research-math/teams/evaluation-doneability"
SORT type ASC
```

## What we audit — every unit in the division claiming an `nf_a.*` metric

```dataview
TABLE WITHOUT ID
  file.link AS Charter,
  department AS Dept,
  default(team, "— dept —") AS Unit,
  metrics AS "Claims"
FROM "01-org/intelligence"
WHERE type = "charter" AND any(map(metrics, (m) => startswith(m, "nf_a")))
SORT department ASC, team ASC
```

## Loops missing a close-time

```dataview
LIST
FROM "01-org/intelligence/research-math/teams/evaluation-doneability"
WHERE type = "loops" AND !contains(file.content, "close_time")
```

## Stale — 60 days untouched is finished or fiction

```dataview
TABLE WITHOUT ID
  file.link AS Doc,
  updated AS "Last touched"
FROM "01-org/intelligence/research-math/teams/evaluation-doneability"
WHERE date(updated) < date(today) - dur(60 days)
SORT updated ASC
```

## The two numbers, side by side — this is the team's product

| | Reading |
|---|---|
| `nf_a.verified_task_success_rate` (independent) | **unmeasured** |
| `base_agent.py:144` `success_rate` (self-reported) | computed today — and "success" means *the handler did not raise* |
| **The gap** | **never computed** |
| `nf_a.verdict_coverage` | near zero outside the merge-policy gate |
| `identity.false_merge_count` | **0** — hard gate, never summed with false splits |
| `golden_sets_with_free_negatives` | **1** of 1 (beverage identity, 732,874 pairs) |
| Task types with written doneability criteria | **0** |

## Task-type coverage — spread, not tractability

- [ ] **Extraction** (menu / wine) — free negatives: same-menu distinctness · prior art exists
- [ ] **Vendor-reply drafting** (`inbound-responder.service.ts`) — generative, commercially risky · needs adjudication policy · SEC-3 supplies injection probes
- [ ] **Analytic answer** — free negative: every claim must trace to the evidence pack (`consultants.service.ts:7-24` forbids inventing numbers — a rule with no test today)

> Coverage is reported as **share of production model spend under a verdict**, never as a
> count of suites. Three extraction suites would move the count and not the number.

## Inventory before building — grade each: reusable / provenance-unknown / retire

- [ ] `scripts/eval_merge_policies.py` + `datasets/merge_eval/` — **reusable, exemplar**
- [ ] `scripts/eval_guest_merge_policies.py` — **reusable, exemplar** (reports 0 pairs by design until guest capture starts)
- [ ] `scripts/build_merge_eval_set.py`
- [ ] `scripts/benchmark_haiku_vs_sonnet.py` · `scripts/claude_vision_benchmark.py`
- [ ] `datasets/scripts/eval_model.py` · `datasets/ocr_benchmark_results.json` · `datasets/OCR_CONFIDENCE_REPORT.md`
- [ ] `services/agent-orchestrator/services/active_learning_service.py:1-17` — "200 gold-standard documents"
- [ ] `services/quality_scorer.py` · `services/field_confidence.py` · `services/ontology_validation_service.py`
- [ ] `.github/workflows/e2e-prod.yml:9` — a weekly AI eval workflow is **reserved and unbuilt**

## Gates we own

- [ ] `identity.false_merge_count = 0` — **live**, inherited, non-negotiable
- [ ] Guest false-merge = 0 — **live**, gate shipped before its data on purpose
- [ ] OD-03 pass conditions — **not written**; must be committed *before* RM-1 runs a candidate
- [ ] Weekly CI eval with a cost cap — **not built**; cap **not named** ([[research-math-agenda-full]] Q6)

## Blocked / waiting

- [ ] **Verdict-carrying NF-A event** — [[neural-footprint-instrumentation-charter]]
- [ ] **Founder: may a verdict block a product release?** Determines whether this team is a gate or advisory
- [ ] **Founder: the monthly cost cap**
- [ ] **Founder: who adjudicates vendor-reply quality?**
- [ ] **Prompt-injection probes** for set #2 — [[security-charter]] SEC-3

## Standing watches (premortem tells)

- [ ] Any pass-condition edit whose commit message names a date, a launch, or a release — **M3, escalate on the first**
- [ ] A third golden set that is also extraction — **M4**
- [ ] A corpus or threshold referenced by both this team and [[aio-evaluation-gates]] — **M5, we file the merge proposal**
- [ ] The verified/self-reported gap narrowing two close-times with no cause — **M1**

## Skill layer

- [ ] Project skills in repo: **1** (`.agents/skills/railway-config/SKILL.md`). Audit stays cheap until ~15 or the first overlap
