---
type: premortem
division: research-math
department: research-math
team: evaluation-doneability
status: provisional
metrics: [nf_a.verified_task_success_rate, nf_a.verdict_coverage, identity.false_merge_count]
updated: 2026-08-24
links: ["[[evaluation-doneability-charter]]", "[[evaluation-doneability-loops]]", "[[evaluation-doneability-directive]]", "[[research-math-premortem]]", "[[harness-model-routing-charter]]", "[[neural-footprint-instrumentation-charter]]", "[[agent-evaluation-gates-charter|aio-evaluation-gates]]", "[[red-team-charter]]", "[[decision-office-charter]]"]
---

# Evaluation & Doneability (RM-2) — Premortem

> Written at founding, before success is assumed.

## It is 2027-08. RM-2 has failed. What happened?

The inherited premortem line (`intelligence.md:136-140`) supplies M1 and M2. Three more
follow — including the one where the team is technically alive and structurally dead.

---

### M1 — The golden sets encoded the author's imagination

The team stood up fast by reusing what existed, and what existed was written by the
sessions that wrote the features. Every probe tested a failure someone had already thought
of. `nf_a.verified_task_success_rate` looked healthy, converged on the self-reported rate,
and everyone read the convergence as truth. It was a shared blind spot, measured twice.
The repo already names this failure in one sentence:
`scripts/eval_guest_merge_policies.py:10` — *a policy self-graded against probes its own
author imagined*.

**Earliest observable signal.** A new golden set whose manifest cannot name a source of
negatives that exists **independently of the person who wrote it**. Also, later and
weaker: the gap between verified and self-reported narrowing for two consecutive
close-times with no change to harness or criteria.

**Counter-pressure.** The repo contains the antidote and it is specific, not
aspirational. The beverage identity key was falsified against **732,874 known-distinct
pairs that were free** — *two entries on one menu are different products* — and that test
killed three designs including one committing 212 false merges
(`eval_guest_merge_policies.py:4-9`). The guest gate uses co-presence the same way: *two
guests on one check are different people*, free from `guest_check_links`. So the rule is:
**every golden set names its source of free negatives in its manifest, or is marked
`imagination-only` and is excluded from any gate that blocks a merge.** Imagination sets
are allowed — they are useful — they simply may not carry authority. Second pressure:
adversarial negatives are authored by whoever did **not** write the feature.

---

### M2 — The weekly eval had no cost cap and was switched off

`.planning/v3.0-TECH-DEBT.md:326-330` specifies weekly CI evals **with cost caps** and
does not name the cap. The suite ships without one. Month one it costs more than anyone
expected and catches nothing visible — which is the normal outcome of a good gate in a
quiet month. Someone disables it "temporarily" to control spend. It is never re-enabled,
because re-enabling requires re-justifying the cost with no recent catch to point at.

**Earliest observable signal.** The first invoice line where the eval suite's spend is
questioned in a channel rather than against a number. The absence of a named cap is the
real signal, and it is visible **today**, before the suite exists.

**Counter-pressure.** The cap is a **founder number, obtained before the suite ships**
([[research-math-agenda-full]] Q6), and overrunning it **escalates** rather than
self-resolving into a switch-off ([[research-math-directive]]). The suite publishes a
running **catch log** — every regression it blocked, with the cost of the regression it
prevented — so the renewal conversation has two numbers instead of one. And the suite is
tiered: a cheap subset runs per-PR, the expensive full run is weekly, so cost pressure
degrades coverage gracefully instead of switching the gate to off.

---

### M3 — The team could not fail RM-1 when it mattered

Failing a sibling on a routing experiment was easy and happened often. Then a verdict
threatened a **product** release date. The pass condition was "revisited"; the golden set
was "corrected"; the threshold moved by a few points with a plausible rationale written by
the team that needed it to move. Nobody lied. The independence rule was never repealed —
it was simply never tested successfully, and after the second time everyone knew what the
answer would be.

**Earliest observable signal.** The **first** edit to a committed pass condition whose
commit message references a date, a launch, or a release. Not the second.

**Counter-pressure.** Pass conditions are committed to the repo **before results exist**
and their history is auditable; a change to one is a reviewed change to a single file,
never a parameter tweak inside a PR of forty ([[evaluation-doneability-directive]]).
Whoever needs the threshold to move cannot be the one who moves it. And the open question
is escalated *now*, at founding, rather than discovered under pressure:
**may a verdict block a product release, or only a sibling's work?**
([[research-math-agenda-full]] Q4). If the answer is "only a sibling's", this team is
advisory in fact, and the charter should say advisory — an honest label beats a hollow
gate, which is the very defect class §44.2 names.

---

### M4 — Evals were built where scoring was easy, not where money was

Extraction against a gold set is pleasant to build: inputs are files, outputs are strings,
the score is a diff. So wine extraction, menu parsing and OCR get suites, and they get
good. The tasks that carry commercial risk — *was this vendor reply appropriate to send?*,
*was this analytic answer defensible?*, *was this procurement decision sound?* — get
nothing, because scoring them needs judgement, rubrics, and probably a model judge. A year
later the department reports high verified success on a population that excludes every
task where being wrong costs real money. This is the sibling division's own premortem for
its evaluation team (`technology.md:418-420`), and it applies identically here.

**Earliest observable signal.** Three golden sets, all of them extraction. The third one
is the tell: the first two are a sensible start, the third is a pattern.

**Counter-pressure.** The team's first three task types are chosen for **spread, not
tractability**: one extraction (wine or menu), one **generative and commercially risky**
(vendor-reply drafting via `inbound-responder.service.ts`, where the output becomes a
staged business communication), and one **judgemental** (analytic answer). The hard ones
may score badly at first — that is a finding, not a failure. Coverage is reported as
*share of production model spend under a verdict*, not as a count of suites, so building
three more extraction evals does not move the number.

---

### M5 — Duplicated `[[agent-evaluation-gates-charter|aio-evaluation-gates]]`, and the seam was defended instead of merged

Both units built golden sets. Both maintained a corpus. The boundary — methodology here,
operations there — was quoted in two charters and honoured in neither, because in practice
you cannot write a rubric without running it, and you cannot run a gate without adjusting
a rubric. Two eval stacks, two sets of thresholds, and eventually a release blocked by one
and passed by the other.

**Earliest observable signal.** The same corpus referenced from two units' documents. Or,
sharper: a threshold that exists in two places with two values.

**Counter-pressure.** `technology.md:406` already prescribes the answer —
*"the fix is to merge this team into Research & Math — not to duplicate it"* — and
[[evaluation-doneability-charter]] accepts that remedy **in advance**. The audit is
monthly ([[research-math-loops]] L6), and the rule is that **RM-2 files the merge proposal
itself** rather than waiting to be merged. A team defending a boundary it was told to
collapse is a slower failure than duplication, not a different one.

---

## Cross-cutting counter-pressure

- **Provenance is a property of a set, not a habit of a team.** Every set is
  `free-negatives` or `imagination-only` in its manifest. That single field kills M1 and
  weakens M4.
- **The gap is the product.** Verified beside self-reported, every close-time. A team that
  publishes only its own number has stopped auditing anyone.
- **[[red-team-charter]] attacks the sets** — provenance, coverage, and whether the three
  chosen task types were chosen for tractability. Findings-only.
- **[[decision-office-charter]] owns the close-times** and owns noticing that a pass
  condition changed near a release date.
- **Anti-sprawl.** Nothing here revisited in 60 days is fiction ([[README]] §3.3).
