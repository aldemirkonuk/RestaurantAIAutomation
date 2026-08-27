---
type: premortem
division: applied-ai
department: ai-orchestration
team: agent-evaluation-gates
status: partial
metrics: [nf_a.doneability_verdict_coverage]
updated: 2026-08-24
links: ["[[agent-evaluation-gates-charter]]", "[[agent-evaluation-gates-loops]]", "[[agent-evaluation-gates-directive]]", "[[ai-orchestration-premortem]]", "[[research-math-charter|research-and-math-charter]]", "[[agent-fleet-charter]]", "[[model-routing-inference-economics-charter]]", "[[decision-office-charter]]", "[[technology]]"]
---

# Agent Evaluation & Gates — Premortem

> Written at founding, before success is assumed.

## It is 12 months from now and this team has failed. What happened?

### 1. Evals were built where scoring was easy, and the dashboard went green over the unmeasured half

The seed premortem, `technology.md:419-421`: *"Evals are built for the tasks that are
easy to score (extraction against a gold set) and never for the ones that matter
commercially (was this vendor reply a *good* reply), so the dashboard is green while
the product's judgment is unmeasured."*

Expanded, because the mechanism is gravitational rather than negligent. Extraction
tasks have a right answer, so a gold set can exist, so a CI gate can exist, so
coverage goes up and the work feels productive. Judgment tasks have no right answer,
so every attempt to build a rubric surfaced disagreement, and disagreement is
expensive, and there was always an extraction family with obvious next steps instead.

Twelve months later: invoice extraction 90% covered, menu parsing 85%, merge policy
gated per-commit — and vendor reply quality at zero, negotiation stance at zero,
recommendation usefulness at zero. `nf_a.doneability_verdict_coverage` reported as one
aggregate number read 62%, which sounded like progress. The first real evidence about
reply quality was a churned customer.

**Earliest observable signal.** The **composition** of the eval corpus, not its size.
Reported per task family, this is visible in week one: extraction families climbing,
judgment families flat at zero. Reported as an aggregate, it is invisible until it
does not matter any more.

**What would have prevented it.** Two rules:
(a) **Coverage is reported per task family, never as one number**, and the families at
zero are **named on the board** rather than omitted from it
([[agent-evaluation-gates-charter]] §Metrics).
(b) **Judgment tasks get a human-rated rubric with inter-rater agreement**, accepted at
low n. A rubric with 30 samples and a measured disagreement rate beats a 10,000-row
metric of the wrong thing. Starting badly on the hard families beats starting well on
the easy ones — and this team's founding condition is that *every* gate running today
scores an extraction-shaped task.

---

### 2. The seam with Research & Math produced two of everything

The line was methodology (R&M) vs. operations (here). It held on paper. In practice
this team needed a rubric for vendor replies, R&M was mid-way through the NF-A schema,
and waiting would have blocked a release. So this team wrote *"a working definition, to
be replaced"*. It was never replaced. R&M later wrote the real one. They disagreed on
edge cases, both had consumers, and neither could be retired without breaking a gate.

`technology.md:845` predicted this exactly: **"Duplication here is worse than either
answer."**

**Earliest observable signal.** This team *defining* rather than *enforcing* — the
first time a rubric, a metric definition, or a doneability criterion originates here.
Once is a coordination miss. **Twice is the line failing.**

**What would have prevented it.** A named escalation with a threshold, in
[[agent-evaluation-gates-directive]]: on the second occurrence, escalate — and the
escalation is *"merge this team into Research & Math"*, per `technology.md:406`,
**never** *"build it in both places"*. The prerequisite nobody could skip — a **usable
ID** — is now met. `technology.md:845` originally called it OD-21, which
the real OD-21 (`OPEN-DECISIONS.md:137`) already spends on the Obsidian workflow, so the Decision Office
renamespaced it to **TECH-F3** ([[FORK-REGISTRY]]). A fork that cannot be cited cannot
be closed, and an uncloseable fork is how duplication becomes permanent.
→ [[decision-office-charter]].

---

### 3. The gate became advisory, then decorative

The merge-policy gate is real: `eval_merge_policies.py:9-16` — *"Exits 1 iff the
proposed policy has any false merge."* New gates were added in its shape. Then one
blocked a Friday release over a 2% regression in a family nobody was sure mattered.
The gate was made non-blocking *"temporarily, until we tune the threshold"*. The
threshold was never tuned. Six months later four of six gates were advisory, they
printed warnings into CI logs nobody read, and the difference between a passing build
and a failing one had quietly become zero.

**Earliest observable signal.** The first gate marked `continue-on-error`, non-blocking,
or warn-only. Not the fourth — the first. And the tell is the word *temporarily* in the
commit message, because that word is what makes it feel reversible.

**What would have prevented it.** A gate is **blocking or it is deleted**; there is no
advisory tier ([[agent-evaluation-gates-directive]] §The blocking rule). If a gate is
too noisy to block, the correct responses are to fix the gate, narrow its scope, or
remove it — all three leave an honest state. An advisory gate is a dashboard element
pretending to be a control, and it is the exact species of failure
[[ai-orchestration-premortem]] is organised around.

---

### 4. The gold sets rotted while the numbers held steady

`eval_merge_policies.py:9-16` has the right instinct: *"Every new menu added to
`datasets/menu_corpus/extracted` strengthens this gate automatically; nobody hand-labels
anything."* The gates built afterwards did not inherit it. They used fixed labelled
sets — including the *"200 gold-standard documents"* at
`services/active_learning_service.py:1-17` — captured once and never refreshed.

The product moved: new vendors, new invoice layouts, bakery items alongside wine, a
second POS. The gold sets did not. Scores stayed at 94% against a distribution the
product had left behind. The gates passed, and the failures were all in the part of
the world the eval set never described.

**Earliest observable signal.** `eval.gold_set_staleness` — days since each set last
grew. A set that has not grown in a quarter while the product shipped new task types
is already measuring history.

**What would have prevented it.** Every gate declares **how its set grows from
production traffic**, at authoring time, as a required field. `eval_merge_policies.py`
already does this and should be the template rather than the exception. A gate whose
set cannot grow is a snapshot, and it should be labelled one.

---

### 5. Confidence scores were calibrated against nothing and trusted anyway

`services/quality_scorer.py`, `services/field_confidence.py` and
`governance.py:227 compute_overall_confidence` all produce numbers. Those numbers
became routing inputs — auto-accept above a threshold, human review below it. The
threshold was chosen by intuition and never validated against outcomes, because
validating it needs paired confidence/outcome data and NF-A was not emitting.

A year on, "confidence 0.9" meant nothing in particular. It was **higher** than 0.7 and
that was the only true statement available about it. Auto-accept at 0.9 was letting
through a materially worse error rate than anyone believed, and the belief was load
bearing: it was what justified reducing human review.

**Earliest observable signal.** A confidence threshold used as an **autonomy** boundary
with no calibration curve behind it. That is checkable today by reading the code, and
it is already true of `governance.py:20`'s tiers.

**What would have prevented it.** A confidence score may gate autonomy **only** once
it has a calibration curve from paired confidence/outcome data. Until then it is a
sort key, not a threshold. This is the same *two-key* discipline
[[model-routing-inference-economics-charter]] applies to cost: a number that has not
been validated against outcomes may inform a decision, but it may not make one.
