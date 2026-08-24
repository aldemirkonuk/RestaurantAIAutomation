---
type: agenda-full
division: research-math
department: research-math
team: evaluation-doneability
status: provisional
metrics: [nf_a.verified_task_success_rate, nf_a.verdict_coverage, identity.false_merge_count]
updated: 2026-08-24
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-premortem]]", "[[evaluation-doneability-agenda-board]]", "[[evaluation-doneability-directive]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-schedule]]", "[[research-math-agenda-full]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[analytics-bi-charter]]", "[[security-charter]]"]
---

# Evaluation & Doneability (RM-2) — Full Agenda

> **PROVISIONAL — no work done yet.** This is forecast, not fact.

## What

Turn "the agent worked" into a **verdict somebody else wrote**, for three task types
chosen for spread rather than for ease — and publish the gap between that verdict and what
the system says about itself.

Four deliverables:

1. **Doneability criteria for three task types**, written down. Today there are zero. The
   only definition of success in the codebase is `base_agent.py:144` —
   `messages_processed / (processed + failed)` — under which **a confidently wrong
   extraction is a success**.
2. **Golden sets with a provenance field.** Each set is `free-negatives` or
   `imagination-only`. Only the first kind may block a merge.
3. **A weekly CI eval suite with a cost cap**, per `.planning/v3.0-TECH-DEBT.md:326-330`
   (§44.11) — which notes it **depends only on Phase 37, satisfied, so it is plannable
   now** and does not wait on SimPOS.
4. **The pass conditions for RM-1's bake-off (OD-03)**, committed before any candidate
   runs.

## How

**Three task types, chosen for spread — this is the single most consequential choice the
team makes, so it is made at founding rather than by drift:**

| # | Task type | Why this one | Source of free negatives |
|---|---|---|---|
| 1 | **Menu / wine extraction** | High volume, already has partial prior art (`datasets/ocr_benchmark_results.json`, `active_learning_service.py:1-17` — "200 gold-standard documents") | Same-menu distinctness, the label that already produced 732,874 pairs |
| 2 | **Vendor-reply drafting** (`inbound-responder.service.ts`) | **Generative and commercially risky** — the output becomes a staged business communication, and attacker-controlled text enters the prompt | Hard. Provisionally `imagination-only` + human adjudication; SEC-3 supplies injection probes |
| 3 | **Analytic answer** | Judgemental, and it is where a confident fabrication costs credibility. `consultants.service.ts:7-24` already forbids inventing numbers — a rule with no test | Evidence-pack citation checking: every claim must trace to the pack, which is mechanically checkable |

**Not three extraction suites.** Extraction is pleasant to score and building three of
them would move a count without moving *share of production model spend under a verdict*
([[evaluation-doneability-premortem]] M4).

**Sequence:**

| Phase | Work | Exit condition |
|---|---|---|
| **0** | **Inventory before building.** `scripts/build_merge_eval_set.py`, `benchmark_haiku_vs_sonnet.py`, `claude_vision_benchmark.py`, `datasets/scripts/eval_model.py`, `ocr_benchmark_results.json`, `OCR_CONFIDENCE_REPORT.md`, `active_learning_service.py`, `quality_scorer.py`, `field_confidence.py`, `ontology_validation_service.py`, `.github/workflows/e2e-prod.yml:9` | Every artifact graded: reusable / provenance-unknown / retire |
| **1** | Write criteria for the three task types. Commit them **before** the bake-off | Three files in the repo, dated, reviewable |
| **2** | Build set #1 with free negatives; wire the first verdict-carrying NF-A event with RM-3 | `nf_a.verified_task_success_rate` reads a number |
| **3** | Publish the **gap** — verified beside `base_agent.py:144` — weekly | Two numbers on one board |
| **4** | Weekly CI suite, tiered: cheap subset per-PR, full run weekly, cost cap named by the founder | Suite green, catch log started |
| **5** | Sets #2 and #3, the hard ones. Bad first scores are findings, not failures | Coverage measured as share of model **spend** under verdict |

**Inherited gate, unchanged from day one:** `identity.false_merge_count = 0`, never summed
with false splits (`scripts/eval_merge_policies.py:5-13`). And
`scripts/eval_guest_merge_policies.py` keeps reporting zero pairs today because guest
capture has not started — that is the gate working, not the gate idle.

## Why now

- **§44.11 is unblocked and nothing else is waiting on it.** It depends only on Phase 37,
  which is satisfied (`v3.0-TECH-DEBT.md:328-330`). Unlike AB-3's truth suite (§44.10,
  blocked on SimPOS), this team has no excuse to be blocked.
- **`base_agent.py:144` is shipping a definition of success that would embarrass us.**
  Every week it runs unchallenged is a week of `success_rate` in a doc or a deck that
  means "did not raise".
- **RM-1's bake-off needs pass conditions written before it starts.** If this team is not
  standing when OD-03 begins, OD-03 grades itself.
- **`.github/workflows/e2e-prod.yml:9` already reserves the slot** for a weekly AI eval
  workflow. The intent is committed; only the work is missing.
- **The methodology already exists in this repo and is unusually good.** Two files
  (`eval_merge_policies.py`, `eval_guest_merge_policies.py`) contain a falsification
  discipline most teams never write down. Extending it is cheaper than inventing it.

## Next steps

- [ ] Inventory and grade the ten scattered eval artifacts; publish the list with provenance verdicts
- [ ] Write doneability criteria for extraction, vendor-reply drafting, and analytic answer
- [ ] Commit OD-03 pass conditions **before** RM-1 runs any candidate — [[harness-model-routing-charter]]
- [ ] Add a `provenance` field to every eval manifest: `free-negatives` | `imagination-only`
- [ ] Build set #1 with a named free-negative source; wire the first verdict event with [[neural-footprint-instrumentation-charter]]
- [ ] Publish verified beside self-reported weekly; the gap is the headline
- [ ] Get the founder's cost cap **before** the weekly suite ships; design tiering so cost pressure degrades coverage instead of switching the gate off
- [ ] Start the catch log — every regression blocked, with the cost of what it prevented
- [ ] Ask SEC-3 for prompt-injection probes for the vendor-reply set — [[security-charter]]
- [ ] Run the monthly duplication audit against [[agent-evaluation-gates-charter|aio-evaluation-gates]]; file the merge proposal ourselves if it trips
- [ ] Start the skill-health report at **1 skill**, and keep it cheap until ~15

## Questions for the founder

1. **May a verdict block a product release, or only a sibling's work?** This is the
   independence rule's real test ([[evaluation-doneability-premortem]] M3). If the answer
   is "only a sibling's", say so and we will label the team **advisory** — an honest label
   beats a hollow gate, which is exactly the defect class `v3.0-TECH-DEBT.md:127` names.
2. **What is the monthly cost cap for the eval suite?** §44.11 requires a cap and does not
   name one. Unnamed, it becomes a switch-off decision made by whoever sees the invoice.
3. **Vendor-reply quality — who adjudicates?** There is no free negative for *"was this
   reply appropriate to send?"*. Options: founder spot-adjudication (slow, authoritative),
   a model judge (fast, needs its own validation), or vendor-reaction outcomes (real, and
   arrives months late). We recommend founder adjudication on a small set first.
4. **Do we grade the five stub agents?** `technology.md` records five agents whose
   `process_message()` only logs. Grading them produces a perfect score on nothing. We
   propose reporting them **separately and never averaged in**; confirm.
5. **Is the merge with [[agent-evaluation-gates-charter|aio-evaluation-gates]] pre-authorized?** `technology.md:406`
   prescribes merge over duplication. If it is pre-authorized, we can act on the monthly
   audit without a decision cycle.
