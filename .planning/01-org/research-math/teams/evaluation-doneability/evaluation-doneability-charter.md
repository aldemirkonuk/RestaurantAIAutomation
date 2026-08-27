---
type: charter
division: research-math
department: research-math
team: evaluation-doneability
status: partial
metrics: [nf_a.verified_task_success_rate, identity.false_merge_count, nf_a.verdict_coverage]
updated: 2026-08-24
links: ["[[evaluation-doneability-premortem]]", "[[evaluation-doneability-agenda-full]]", "[[evaluation-doneability-agenda-board]]", "[[evaluation-doneability-directive]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-schedule]]", "[[research-math-charter]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[analytics-bi-charter]]", "[[skills-charter]]", "[[intelligence]]", "[[OPEN-DECISIONS]]"]
---

# Evaluation & Doneability (RM-2) — Charter

Parent: [[research-math-charter]] · Division: **Intelligence** · Siblings:
[[harness-model-routing-charter]], [[neural-footprint-instrumentation-charter]].

## Mandate

Define what **"done"** means per task type; build the golden sets and adversarial
negatives that test it; own the CI gates that block regressions — including the
anti-sprawl audit of the skill layer ([[README]] §3.3). RM-2 is the only team in this
department whose output is a **verdict**.

## Why distinct from its siblings — and the independence rule

[[harness-model-routing-charter]] owns the producer.
[[neural-footprint-instrumentation-charter]] owns the recorder. RM-2 is the auditor, and
**it must be able to fail RM-1.**

This is not a courtesy. Merging evaluation into the harness team makes
`task_success_rate` self-reported, which is precisely the defect class
`.planning/v3.0-TECH-DEBT.md:127` (§44.2) already names as live in this repo: *"Hollow
features that report success."* The same structural argument [[ORG_STRUCTURE]] §3 uses to
place Red Team outside the line applies one level down, inside this department.

**The rule, in four clauses** (also stated in [[research-math-charter]], deliberately
duplicated so neither document can quietly drop it):

1. **Pass conditions are committed before results exist.** RM-2 writes the bake-off's pass
   condition before RM-1 runs a single candidate.
2. **RM-1 may not modify a golden set, a threshold, or a pass condition.** It may dispute
   one in writing; disputes resolve at the founder or [[decision-office-charter]], never
   at the author.
3. **A failing verdict publishes.** Disagreement publishes beside it, not instead of it.
4. **Verified is always reported beside self-reported.**
   `nf_a.verified_task_success_rate` next to `base_agent.py:144`'s `success_rate`. **The
   gap between the two is this team's actual product** — it is the measured size of the
   repo's self-reporting problem.

If clause 1 or 2 is ever suspended for a deadline, this team has been merged into RM-1 in
practice, whatever the org chart says.

## Boundaries

Owns outright:

- **Doneability criteria per task type** — the definitions themselves. Today there are
  none.
- **Golden sets and adversarial negatives**, and each set's **provenance record**: does it
  have a source of *free* negatives, or is it authored imagination?
- **CI eval gates** that block a merge, including the inherited hard gate
  `identity.false_merge_count = 0`.
- **Pass conditions for RM-1's bake-off** (OD-03) and for every routing change (OD-04).
- **The skill-layer anti-sprawl audit** ([[README]] §3.3) — T4 folded here rather than
  given a fourth team, because "has this skill fired in 30 days" is a *measurement* job
  and step 2 of the skill protocol literally is *name the doneability criteria*
  (`intelligence.md:504`).

## Explicit non-goals

| Not ours | Whose it is | The line |
|---|---|---|
| How the output was produced, and what it cost | [[harness-model-routing-charter]] | We grade; we do not tune. A team that both spends and scores optimises the scorecard by spending |
| The NF-A schema and join keys | [[neural-footprint-instrumentation-charter]] | We consume verdict-carrying events; we do not define the contract |
| **Running** the gates in CI and production | [[agent-evaluation-gates-charter|aio-evaluation-gates]] *(Applied AI)* | **Methodology here, operations there** — and if the line fails, **merge, do not duplicate** (`technology.md:406`) |
| Exact-equality checks of deterministic arithmetic against a ledger | [[analytics-bi-charter]] AB-3 | We grade **nondeterministic** model output with judges and thresholds; AB-3 grades exact equality. Shared vocabulary, different work (`intelligence.md:460-464`) |
| Authoring or maintaining skills | [[skills-charter]] *(Applied AI)* | They own the registry; we own whether a skill earns its place |
| Whether an insight was *worth saying* | [[analytics-bi-charter]] AB-2 | Correctness is ours; usefulness is theirs |

### The evaluation seam, and this charter's position on it

`technology.md:392-406` charters `[[agent-evaluation-gates-charter|aio-evaluation-gates]]` to **run and enforce**
doneability and states the same boundary in the same words. It also prescribes the remedy
if the line fails: *merge this team into Research & Math — not duplicate it.* **This
charter accepts that remedy in advance.** If within two close-times either unit is
maintaining a golden set the other also maintains, RM-2 files the merge proposal itself.
Defending scope here is a failure mode we are choosing not to have.

*(ID note: `technology.md` originally numbered this seam "OD-21", colliding with the
global OD-21 — Obsidian workflow — at `OPEN-DECISIONS.md:135`. [[decision-office-charter]]
reconciled it: the seam is **TECH-F3** ([[FORK-REGISTRY]]).)*

## Metrics it moves

| Metric | Definition | Baseline |
|---|---|---|
| `nf_a.verified_task_success_rate` | Success as scored by an **independent** verdict | Near zero outside the merge-policy gate |
| *(the gap)* verified − self-reported | The measured size of the self-reporting problem | Unknown — never computed |
| `nf_a.verdict_coverage` | Share of agent tasks emitting a machine-checkable verdict rather than a log line | Near zero outside the merge-policy gate |
| `identity.false_merge_count` | **Inherited hard gate: 0.** Never summed with false splits (`scripts/eval_merge_policies.py:5-13`) | 0 — and it must stay 0 |
| `golden_sets_with_free_negatives` | Sets whose negatives fall out of the world rather than out of a session | **1** (beverage identity) |

## Evidence today

**PARTIAL — and the strongest existing culture artifact in the codebase.**

**EXISTS — a working falsification harness.** `scripts/eval_merge_policies.py` +
`datasets/merge_eval/` (946KB `entries.json`, `adjudicated.json`, `manifest.json`). Per
`scripts/eval_guest_merge_policies.py:1-13`, the beverage identity key was tested against
**732,874 free known-distinct pairs** — "two entries on one menu are different products",
a label nobody had to author — and that test **killed three earlier designs, one of which
committed 212 false merges**.

**EXISTS — a gate shipped before its data.** `scripts/eval_guest_merge_policies.py` is the
guest equivalent, deliberately shipped before guest capture starts (`:19-24`): *"a gate
added after the data is a gate written by someone who already knows what the data looks
like."* Its pass condition is **exactly zero**, because (`:28-32`) a false guest merge is
*a DISCLOSURE — one person's dining history, spend, allergies and companions become
readable as another's* — not a data-quality error, and no un-merge reverses a disclosure.
Its free negatives come from co-presence: two guests on the same check are different
people, which falls out of `guest_check_links` at no storage cost via the
`guest_copresence_negatives` view.

**These two files are the team's founding methodology, not merely prior art.** Everything
below is the same discipline applied to task types that do not yet have it.

**NEW — everything else.** `.planning/v3.0-TECH-DEBT.md:326-330` (§44.11, "AI Eval
Suites") specifies golden datasets and **weekly CI evals with cost caps** for wine
extraction, email intelligence, agent decisions and analytic answers — and notes it
**depends only on Phase 37, which is satisfied, so it is plannable now** and does not wait
on the SimPOS simulator (unlike AB-3's §44.10 at `:322-325`). Nothing has been built.

**NEW — doneability criteria are asserted nowhere.** `base_agent.py:144` computes a
`success_rate` where "success" means *`messages_processed / (processed + failed)`* — i.e.
the handler did not raise. **Under that definition a confidently wrong extraction is a
success.** That single line is the reason this team exists.

**Scattered, unowned prior art** that RM-2 must inventory before building anything new
(`technology.md:408-414`): `scripts/build_merge_eval_set.py`,
`scripts/benchmark_haiku_vs_sonnet.py`, `scripts/claude_vision_benchmark.py`,
`datasets/scripts/eval_model.py`, `datasets/ocr_benchmark_results.json`,
`datasets/OCR_CONFIDENCE_REPORT.md`,
`services/agent-orchestrator/services/active_learning_service.py:1-17` ("200
gold-standard documents for regression testing"), `services/quality_scorer.py`,
`services/field_confidence.py`, `services/ontology_validation_service.py`. Also
`.github/workflows/e2e-prod.yml:9`, which explicitly **reserves** a weekly AI eval
workflow that does not exist.

## Where the evidence is thin, said plainly

Two of the team's three metrics have **no instrument and no prior art**:
`verified_task_success_rate` and `verdict_coverage` require a verdict-carrying event that
[[neural-footprint-instrumentation-charter]] has not built yet. The merge-policy gates are
excellent and they cover **one** domain — identity — out of at least four named task
types. This team is a strong methodology attached to a nearly empty corpus, and the
charter should not read as though the corpus exists.

## Entry trigger for the skill-layer audit

The repo has **one** project skill (`.agents/skills/railway-config/SKILL.md`). The
anti-sprawl audit becomes real work at **~15 skills, or the first two skills found to
overlap in production** (`intelligence.md:504`). Until then the audit runs, reports "1
skill, fired/not fired", and costs nothing — a habit built before it is needed, which is
the same reasoning that made `eval_guest_merge_policies.py` ship before its data.
